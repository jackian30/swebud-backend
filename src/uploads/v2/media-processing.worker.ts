import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { chmod, lstat, mkdtemp, readdir, realpath, rm, stat, unlink } from 'fs/promises';
import { hostname } from 'os';
import { extname, join } from 'path';
import { booleanConfig } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { collectionFor } from '../media-library/collections';
import { processingTempDirectory } from '../media-library/media-processor.service';
import { MediaCollectionName } from '../media-library/types';
import { MediaPipelineError } from './malware-scanner';
import { SecureMediaPipeline } from './secure-media-pipeline';
import {
  UPLOAD_OBJECT_STORE,
  UploadObjectStore,
} from './upload-object-store';
import { uploadPolicy } from './upload-policy';
import { UploadV2Service } from './upload-v2.service';

type ClaimedJob = {
  id: string;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
  session: {
    id: string;
    userId: string;
    collection: string;
    declaredMimeType: string;
    declaredSize: number;
    declaredSha256: string | null;
    quarantineBucket: string;
    quarantineKey: string;
    status: string;
    asset: { id: string } | null;
  };
};

@Injectable()
export class MediaProcessingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaProcessingWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomBytes(8).toString('hex')}`;
  private readonly running = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly uploads: UploadV2Service,
    private readonly pipeline: SecureMediaPipeline,
    @Inject(UPLOAD_OBJECT_STORE) private readonly objects: UploadObjectStore,
  ) {}

  onModuleInit() {
    if (!booleanConfig(
      this.config,
      'MEDIA_UPLOAD_WORKER_ENABLED',
      process.env.NODE_ENV === 'production',
    )) return;
    this.timer = setInterval(
      () => void this.runOnce().catch(() => undefined),
      this.pollMilliseconds(),
    );
    this.timer.unref();
    void this.runOnce().catch(() => undefined);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.running]);
  }

  async runOnce() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const policy = uploadPolicy(this.config);
      const available = policy.workerConcurrency - this.running.size;
      if (available > 0) {
        const jobs = await this.claim(available, policy.jobLeaseSeconds).catch((error: unknown) => {
          this.logMaintenanceFailure('job claim', error);
          return [];
        });
        for (const job of jobs) {
          const task = this.processJob(job)
            .catch(() => undefined)
            .finally(() => this.running.delete(task));
          this.running.add(task);
        }
      }
      const maintenanceLimit = 5;
      await Promise.all([
        this.runMaintenance(
          'expired quarantine cleanup',
          () => this.uploads.cleanupExpired(maintenanceLimit),
        ),
        this.runMaintenance(
          'stale multipart completion reconciliation',
          () => this.uploads.reconcileStaleCompletions(maintenanceLimit),
        ),
        this.runMaintenance(
          'cancelled quarantine cleanup',
          () => this.uploads.cleanupCancelled(maintenanceLimit),
        ),
        this.runMaintenance(
          'terminal quarantine cleanup',
          () => this.uploads.cleanupTerminal(maintenanceLimit),
        ),
        this.runMaintenance(
          'ready quarantine cleanup',
          () => this.cleanupReadyQuarantine(maintenanceLimit),
        ),
        this.runMaintenance(
          'orphan public cleanup',
          () => this.cleanupOrphanPublished(maintenanceLimit),
        ),
        this.runMaintenance('stale worker temp cleanup', () => this.cleanupStaleWorkerTemp()),
      ]);
    } finally {
      this.ticking = false;
    }
  }

  private async claim(limit: number, leaseSeconds: number): Promise<ClaimedJob[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
    await this.deadLetterExhaustedLeases(now);
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "media_processing_jobs"
        WHERE (
          (
            "status" IN (
              'pending'::"media_processing_job_status",
              'retry_wait'::"media_processing_job_status"
            )
            AND "available_at" <= ${now}
            AND "attempts" < "max_attempts"
          )
          OR (
            "status" = 'leased'::"media_processing_job_status"
            AND "lease_expires_at" <= ${now}
            AND "attempts" < "max_attempts"
          )
        )
        ORDER BY "available_at" ASC, "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "media_processing_jobs" AS job
      SET
        "status" = 'leased'::"media_processing_job_status",
        "attempts" = job."attempts" + 1,
        "lease_owner" = ${this.workerId},
        "leased_at" = ${now},
        "lease_expires_at" = ${leaseExpiresAt},
        "updated_at" = ${now}
      FROM candidates
      WHERE job."id" = candidates."id"
      RETURNING job."id"
    `);
    if (!claimed.length) return [];
    return this.prisma.mediaProcessingJob.findMany({
      where: { id: { in: claimed.map((job) => job.id) } },
      include: {
        session: {
          include: { asset: { select: { id: true } } },
        },
      },
    }) as unknown as Promise<ClaimedJob[]>;
  }

  private async processJob(job: ClaimedJob) {
    let directory: string | undefined;
    let processedPath: string | undefined;
    let leaseTimer: NodeJS.Timeout | undefined;
    let stagedTarget: { id: string; bucket: string; key: string } | undefined;
    let finalized = false;
    try {
      if (!job.session.asset) {
        throw new MediaPipelineError('UPLOAD_ASSET_MISSING', 'Quarantined asset record is missing.', false);
      }
      if (['cancelled', 'expired', 'rejected'].includes(job.session.status)) {
        await this.cancelJob(job);
        return;
      }
      const began = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const locked = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
          SELECT "status"::text AS "status"
          FROM "media_upload_sessions"
          WHERE "id" = ${job.session.id}::uuid
          FOR UPDATE
        `);
        if (!['queued', 'processing'].includes(locked[0]?.status ?? '')) return false;
        const leased = await tx.mediaProcessingJob.updateMany({
          where: {
            id: job.id,
            status: 'leased',
            leaseOwner: this.workerId,
            attempts: job.attempts,
            leaseExpiresAt: { gt: now },
          },
          data: { lastErrorCode: null, lastErrorMessage: null },
        });
        if (!leased.count) return false;
        const session = await tx.mediaUploadSession.updateMany({
          where: { id: job.session.id, status: { in: ['queued', 'processing'] } },
          data: { status: 'processing' },
        });
        if (!session.count) return false;
        await tx.mediaAsset.update({
          where: { sessionId: job.session.id },
          data: { status: 'processing', failureCode: null, failureMessage: null },
        });
        return true;
      });
      if (!began) return;
      const policy = uploadPolicy(this.config);
      leaseTimer = setInterval(
        () => void this.renewLease(job, policy.jobLeaseSeconds),
        Math.max(10_000, Math.floor(policy.jobLeaseSeconds * 1000 / 3)),
      );
      leaseTimer.unref();

      const base = processingTempDirectory();
      directory = await mkdtemp(join(base, 'worker-'));
      await chmod(directory, 0o700);
      const directoryInfo = await lstat(directory);
      const resolved = await realpath(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !resolved.startsWith(`${base}/`)) {
        throw new MediaPipelineError('UNSAFE_TEMP_DIRECTORY', 'Worker temporary directory is unsafe.', true);
      }
      const inputPath = join(directory, 'input');
      await this.objects.downloadQuarantineToFile({
        bucket: job.session.quarantineBucket,
        key: job.session.quarantineKey,
        destinationPath: inputPath,
      });
      await chmod(inputPath, 0o600);
      const inputInfo = await lstat(inputPath);
      const inputStat = await stat(inputPath);
      if (!inputInfo.isFile() || inputInfo.isSymbolicLink() || inputStat.size !== job.session.declaredSize) {
        throw new MediaPipelineError(
          'QUARANTINE_SIZE_MISMATCH',
          'Downloaded quarantine object does not match its declared size.',
          false,
        );
      }

      const processed = await this.pipeline.process({
        path: inputPath,
        size: inputStat.size,
        mimeType: job.session.declaredMimeType,
        collection: job.session.collection,
        declaredSha256: job.session.declaredSha256,
      });
      processedPath = processed.temporary ? processed.path : undefined;
      const collection = collectionFor(job.session.collection as MediaCollectionName);
      const publishAttemptId = randomUUID();
      const publicKey = `${collection.folder}/v2/${job.session.asset.id}/${job.id}-${job.attempts}-${publishAttemptId}${extname(processed.filename)}`;
      const publicBucket = this.objects.publicBucket();
      await this.stagePublishedTarget(
        job,
        publishAttemptId,
        publicBucket,
        publicKey,
        policy.jobLeaseSeconds,
      );
      stagedTarget = { id: publishAttemptId, bucket: publicBucket, key: publicKey };
      const published = await this.objects.publishFromFile({
        key: publicKey,
        path: processed.path,
        contentType: processed.mimeType,
        metadata: {
          'asset-id': job.session.asset.id,
          'upload-session-id': job.session.id,
          'owner-id': job.session.userId,
          'input-sha256': processed.inputSha256,
        },
      });
      const publishedAttempt = await this.prisma.mediaPublishAttempt.updateMany({
        where: { id: publishAttemptId, status: 'staged' },
        data: { status: 'published', publishedAt: new Date() },
      });
      if (publishedAttempt.count !== 1) {
        throw new MediaPipelineError(
          'UPLOAD_CANCELLED_OR_LEASE_LOST',
          'Publish attempt ownership was lost before finalization.',
          false,
        );
      }

      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const locked = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
          SELECT "status"::text AS "status"
          FROM "media_upload_sessions"
          WHERE "id" = ${job.session.id}::uuid
          FOR UPDATE
        `);
        if (locked[0]?.status !== 'processing') {
          throw new MediaPipelineError(
            'UPLOAD_CANCELLED_OR_LEASE_LOST',
            'Upload was cancelled before finalization.',
            false,
          );
        }
        const lease = await tx.mediaProcessingJob.updateMany({
          where: {
            id: job.id,
            status: 'leased',
            leaseOwner: this.workerId,
            attempts: job.attempts,
            leaseExpiresAt: { gt: now },
          },
          data: {
            status: 'succeeded',
            leaseOwner: null,
            leasedAt: null,
            leaseExpiresAt: null,
            completedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        if (!lease.count) {
          throw new MediaPipelineError(
            'UPLOAD_CANCELLED_OR_LEASE_LOST',
            'Upload was cancelled or the worker lease was lost.',
            false,
          );
        }
        const session = await tx.mediaUploadSession.updateMany({
          where: { id: job.session.id, status: 'processing' },
          data: { status: 'ready', failureCode: null, failureMessage: null },
        });
        if (!session.count) {
          throw new MediaPipelineError(
            'UPLOAD_CANCELLED_OR_LEASE_LOST',
            'Upload was cancelled or the worker lease was lost.',
            false,
          );
        }
        await tx.mediaAsset.update({
          where: { sessionId: job.session.id },
          data: {
            status: 'ready',
            mimeType: processed.mimeType,
            byteSize: processed.size,
            sha256: processed.inputSha256,
            publicBucket: published.bucket,
            publicKey: published.key,
            publicUrl: published.url,
            width: processed.width,
            height: processed.height,
            durationSeconds: processed.durationSeconds,
            failureCode: null,
            failureMessage: null,
          },
        });
        const winner = await tx.mediaPublishAttempt.updateMany({
          where: { id: publishAttemptId, status: 'published' },
          data: { status: 'winner', finalizedAt: new Date(), lastError: null },
        });
        if (winner.count !== 1) {
          throw new MediaPipelineError(
            'UPLOAD_CANCELLED_OR_LEASE_LOST',
            'Publish attempt was claimed for cleanup before finalization.',
            false,
          );
        }
        await tx.mediaPublishAttempt.updateMany({
          where: {
            sessionId: job.session.id,
            id: { not: publishAttemptId },
            status: { in: ['staged', 'published'] },
          },
          data: { status: 'cleanup_pending' },
        });
      });
      finalized = true;

      await this.objects.deleteQuarantine({
        bucket: job.session.quarantineBucket,
        key: job.session.quarantineKey,
      }).then(async () => {
        await this.prisma.mediaUploadSession.update({
          where: { id: job.session.id },
          data: { quarantineDeletedAt: new Date() },
        });
      }).catch(() => undefined);
    } catch (error) {
      if (stagedTarget && !finalized) {
        const committedWinner = await this.prisma.mediaPublishAttempt.findUnique({
          where: { id: stagedTarget.id },
          select: { status: true },
        }).then((attempt) => attempt?.status === 'winner').catch(() => false);
        if (committedWinner) {
          finalized = true;
          await this.objects.deleteQuarantine({
            bucket: job.session.quarantineBucket,
            key: job.session.quarantineKey,
          }).then(async () => {
            await this.prisma.mediaUploadSession.updateMany({
              where: { id: job.session.id, status: 'ready', quarantineDeletedAt: null },
              data: { quarantineDeletedAt: new Date() },
            });
          }).catch(() => undefined);
          return;
        }
        // A rejected/timed-out PUT can still finish remotely. Preserve the
        // cleanup handle and let the grace+tombstone maintenance path perform
        // delayed repeated deletion.
        await this.prisma.mediaPublishAttempt.updateMany({
          where: { id: stagedTarget.id, status: { in: ['staged', 'published'] } },
          data: {
            status: 'cleanup_pending',
            cleanedAt: null,
            lastError: error instanceof Error ? error.message.slice(0, 1_000) : 'Publish attempt failed.',
          },
        }).catch(() => undefined);
      }
      await this.failJob(job, error);
    } finally {
      if (leaseTimer) clearInterval(leaseTimer);
      if (processedPath) await unlink(processedPath).catch(() => undefined);
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async failJob(job: ClaimedJob, error: unknown) {
    const current = await this.prisma.mediaUploadSession.findUnique({
      where: { id: job.session.id },
      select: { status: true },
    }).catch(() => null);
    if (current?.status === 'cancelled') {
      await this.cancelJob(job);
      return;
    }
    const failure = error instanceof MediaPipelineError
      ? error
      : new MediaPipelineError('MEDIA_PROCESSING_FAILED', 'Media processing failed unexpectedly.', true);
    const message = failure.message.slice(0, 1_000);
    const retry = failure.retryable && job.attempts < job.maxAttempts;
    if (retry) {
      const delaySeconds = Math.min(60 * 60, 30 * 2 ** Math.max(0, job.attempts - 1));
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "media_upload_sessions" WHERE "id" = ${job.session.id}::uuid FOR UPDATE`;
        const lease = await tx.mediaProcessingJob.updateMany({
          where: {
            id: job.id,
            status: 'leased',
            leaseOwner: this.workerId,
            attempts: job.attempts,
          },
          data: {
            status: 'retry_wait',
            availableAt: new Date(Date.now() + delaySeconds * 1000),
            leaseOwner: null,
            leasedAt: null,
            leaseExpiresAt: null,
            lastErrorCode: failure.code,
            lastErrorMessage: message,
          },
        });
        if (!lease.count) return false;
        await tx.mediaUploadSession.updateMany({
          where: { id: job.session.id, status: 'processing' },
          data: { status: 'queued', failureCode: failure.code, failureMessage: message },
        });
        await tx.mediaAsset.updateMany({
          where: { sessionId: job.session.id, status: 'processing' },
          data: { status: 'quarantined', failureCode: failure.code, failureMessage: message },
        });
        return true;
      });
      return;
    }

    const sessionStatus = failure.retryable ? 'failed' : 'rejected';
    const deadLettered = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "media_upload_sessions" WHERE "id" = ${job.session.id}::uuid FOR UPDATE`;
      const lease = await tx.mediaProcessingJob.updateMany({
        where: {
          id: job.id,
          status: 'leased',
          leaseOwner: this.workerId,
          attempts: job.attempts,
        },
        data: {
          status: 'dead_letter',
          leaseOwner: null,
          leasedAt: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
          lastErrorCode: failure.code,
          lastErrorMessage: message,
        },
      });
      if (!lease.count) return false;
      await tx.mediaUploadSession.updateMany({
        where: { id: job.session.id, status: { in: ['queued', 'processing'] } },
        data: { status: sessionStatus, failureCode: failure.code, failureMessage: message },
      });
      await tx.mediaAsset.updateMany({
        where: { sessionId: job.session.id, status: { in: ['quarantined', 'processing'] } },
        data: { status: 'rejected', failureCode: failure.code, failureMessage: message },
      });
      return true;
    });
    if (!deadLettered) return;
    await this.objects.deleteQuarantine({
      bucket: job.session.quarantineBucket,
      key: job.session.quarantineKey,
    }).then(async () => {
      await this.prisma.mediaUploadSession.update({
        where: { id: job.session.id },
        data: { quarantineDeletedAt: new Date() },
      });
    }).catch(() => undefined);
  }

  private async cancelJob(job: ClaimedJob) {
    await this.prisma.mediaProcessingJob.updateMany({
      where: {
        id: job.id,
        status: 'leased',
        leaseOwner: this.workerId,
        attempts: job.attempts,
      },
      data: {
        status: 'cancelled',
        leaseOwner: null,
        leasedAt: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    });
  }

  private async stagePublishedTarget(
    job: ClaimedJob,
    publishAttemptId: string,
    bucket: string,
    key: string,
    leaseSeconds: number,
  ) {
    const now = new Date();
    const fenced = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        SELECT "status"::text AS "status"
        FROM "media_upload_sessions"
        WHERE "id" = ${job.session.id}::uuid
        FOR UPDATE
      `);
      if (locked[0]?.status !== 'processing') return false;
      const lease = await tx.mediaProcessingJob.updateMany({
        where: {
          id: job.id,
          status: 'leased',
          leaseOwner: this.workerId,
          attempts: job.attempts,
          leaseExpiresAt: { gt: now },
        },
        data: { leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000) },
      });
      if (!lease.count) return false;
      await tx.mediaPublishAttempt.create({
        data: {
          id: publishAttemptId,
          sessionId: job.session.id,
          assetId: job.session.asset!.id,
          jobId: job.id,
          workerId: this.workerId,
          attempt: job.attempts,
          publicBucket: bucket,
          publicKey: key,
          status: 'staged',
        },
      });
      await tx.mediaAsset.update({
        where: { sessionId: job.session.id },
        data: { publicBucket: bucket, publicKey: key, publicUrl: null },
      });
      return true;
    });
    if (!fenced) {
      throw new MediaPipelineError(
        'UPLOAD_CANCELLED_OR_LEASE_LOST',
        'Upload was cancelled or the worker lease was lost before publish.',
        false,
      );
    }
  }

  private async renewLease(job: ClaimedJob, leaseSeconds: number) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.mediaUploadSession.count({
        where: { id: job.session.id, status: 'processing' },
      });
      if (!session) return;
      await tx.mediaProcessingJob.updateMany({
        where: {
          id: job.id,
          status: 'leased',
          leaseOwner: this.workerId,
          attempts: job.attempts,
          leaseExpiresAt: { gt: now },
        },
        data: { leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000) },
      });
    }).catch(() => undefined);
  }

  private async deadLetterExhaustedLeases(now: Date) {
    await this.prisma.$transaction(async (tx) => {
      const exhausted = await tx.$queryRaw<Array<{ sessionId: string }>>(Prisma.sql`
        WITH candidates AS MATERIALIZED (
          SELECT
            job."id",
            job."session_id"
          FROM "media_upload_sessions" AS session
          INNER JOIN "media_processing_jobs" AS job
            ON job."session_id" = session."id"
          WHERE
            job."status" = 'leased'::"media_processing_job_status"
            AND job."lease_expires_at" <= ${now}
            AND job."attempts" >= job."max_attempts"
          ORDER BY job."lease_expires_at" ASC, job."created_at" ASC
          FOR UPDATE OF session SKIP LOCKED
          LIMIT 100
        )
        UPDATE "media_processing_jobs" AS job
        SET
          "status" = 'dead_letter'::"media_processing_job_status",
          "lease_owner" = NULL,
          "leased_at" = NULL,
          "lease_expires_at" = NULL,
          "completed_at" = ${now},
          "last_error_code" = 'WORKER_RETRIES_EXHAUSTED',
          "last_error_message" = 'Worker lease expired after the maximum number of attempts.',
          "updated_at" = ${now}
        FROM candidates
        WHERE
          job."id" = candidates."id"
          AND job."status" = 'leased'::"media_processing_job_status"
          AND job."lease_expires_at" <= ${now}
          AND job."attempts" >= job."max_attempts"
        RETURNING job."session_id" AS "sessionId"
      `);
      if (!exhausted.length) return;
      const sessionIds = exhausted.map((row) => row.sessionId);
      await tx.mediaUploadSession.updateMany({
        where: { id: { in: sessionIds }, status: { in: ['queued', 'processing'] } },
        data: {
          status: 'failed',
          failureCode: 'WORKER_RETRIES_EXHAUSTED',
          failureMessage: 'Media processing retries were exhausted.',
        },
      });
      await tx.mediaAsset.updateMany({
        where: { sessionId: { in: sessionIds }, status: { in: ['quarantined', 'processing'] } },
        data: {
          status: 'rejected',
          failureCode: 'WORKER_RETRIES_EXHAUSTED',
          failureMessage: 'Media processing retries were exhausted.',
        },
      });
    });
  }

  private async cleanupReadyQuarantine(limit: number) {
    const sessions = await this.prisma.mediaUploadSession.findMany({
      where: { status: 'ready', quarantineDeletedAt: null },
      select: { id: true, quarantineBucket: true, quarantineKey: true },
      orderBy: { completedAt: 'asc' },
      take: limit,
    });
    await Promise.all(sessions.map(async (session) => {
      await this.objects.deleteQuarantine({
        bucket: session.quarantineBucket,
        key: session.quarantineKey,
      }).then(async () => {
        await this.prisma.mediaUploadSession.updateMany({
          where: { id: session.id, status: 'ready', quarantineDeletedAt: null },
          data: { quarantineDeletedAt: new Date() },
        });
      }).catch(() => undefined);
    }));
  }

  private async cleanupOrphanPublished(limit: number) {
    const policy = uploadPolicy(this.config);
    const now = new Date();
    const graceCutoff = new Date(
      now.getTime() - policy.publishCleanupGraceSeconds * 1000,
    );
    const tombstoneCutoff = new Date(
      now.getTime() - policy.publishCleanupTombstoneSeconds * 1000,
    );
    const attempts = await this.prisma.mediaPublishAttempt.findMany({
      where: {
        status: { in: ['staged', 'published', 'cleanup_pending'] },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    await Promise.all(attempts.map(async (attempt) => {
      const job = await this.prisma.mediaProcessingJob.findUnique({
        where: { id: attempt.jobId },
        select: { status: true, attempts: true, leaseOwner: true, leaseExpiresAt: true },
      });
      const activelyOwned = (
        job?.status === 'leased' &&
        job.attempts === attempt.attempt &&
        job.leaseOwner === attempt.workerId &&
        (job.leaseExpiresAt?.getTime() ?? 0) > Date.now()
      );
      if (activelyOwned) return;

      // `staged` means the PUT may still be running. Deleting now could race a
      // late completion and then discard the only cleanup handle. Convert it
      // to a durable tombstone first; cleanup_pending is retained through two
      // delayed delete passes.
      if (attempt.status === 'staged') {
        await this.prisma.mediaPublishAttempt.updateMany({
          where: { id: attempt.id, status: 'staged' },
          data: { status: 'cleanup_pending', lastError: null },
        });
        return;
      }
      if (attempt.status === 'published') {
        const claimed = await this.prisma.mediaPublishAttempt.updateMany({
          where: { id: attempt.id, status: 'published' },
          data: { status: 'cleanup_pending', cleanedAt: null, lastError: null },
        });
        if (claimed.count !== 1) return;
      }
      if (attempt.status === 'cleanup_pending') {
        if (attempt.createdAt > graceCutoff) return;
        if (!attempt.cleanedAt) {
          await this.objects.deletePublished(attempt.publicBucket, attempt.publicKey)
            .then(async () => {
              await this.prisma.mediaPublishAttempt.updateMany({
                where: { id: attempt.id, status: 'cleanup_pending', cleanedAt: null },
                data: { cleanedAt: now, lastError: null },
              });
            })
            .catch(async (cleanupError: unknown) => {
              await this.recordPublishCleanupFailure(attempt.id, cleanupError);
            });
          return;
        }
        if (attempt.cleanedAt > tombstoneCutoff) return;
      }

      // `published` is safe for immediate deletion because the PUT returned
      // before that state was recorded. cleanup_pending reaches this branch
      // only for the second delete after its grace+tombstone windows.
      await this.objects.deletePublished(attempt.publicBucket, attempt.publicKey).then(async () => {
        await this.prisma.$transaction([
          this.prisma.mediaPublishAttempt.updateMany({
            where: { id: attempt.id, status: { not: 'winner' } },
            data: { status: 'cleaned', cleanedAt: new Date(), lastError: null },
          }),
          this.prisma.mediaAsset.updateMany({
            where: {
              id: attempt.assetId,
              status: { not: 'ready' },
              publicBucket: attempt.publicBucket,
              publicKey: attempt.publicKey,
            },
            data: { publicBucket: null, publicKey: null, publicUrl: null },
          }),
        ]);
      }).catch(async (cleanupError: unknown) => {
        await this.recordPublishCleanupFailure(attempt.id, cleanupError);
      }).catch(() => undefined);
    }));
  }

  private async recordPublishCleanupFailure(attemptId: string, cleanupError: unknown) {
    await this.prisma.mediaPublishAttempt.updateMany({
      where: { id: attemptId, status: { not: 'winner' } },
      data: {
        status: 'cleanup_pending',
        lastError: cleanupError instanceof Error
          ? cleanupError.message.slice(0, 1_000)
          : 'Public cleanup failed.',
      },
    }).catch(() => undefined);
  }

  private async cleanupStaleWorkerTemp() {
    const base = processingTempDirectory();
    const thresholdSeconds = this.boundedConfig(
      'MEDIA_PROCESSING_STALE_TEMP_SECONDS',
      6 * 60 * 60,
      60 * 60,
      7 * 24 * 60 * 60,
    );
    const limit = this.boundedConfig('MEDIA_PROCESSING_STALE_CLEANUP_LIMIT', 100, 1, 500);
    const cutoff = Date.now() - thresholdSeconds * 1000;
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (removed >= limit) break;
      const workerDirectory = entry.isDirectory() && /^worker-[A-Za-z0-9_-]+$/.test(entry.name);
      const serverOutput = entry.isFile() && /^[a-f0-9]{48}\.(?:webp|mp4|m4a)$/.test(entry.name);
      if (!workerDirectory && !serverOutput) continue;
      const path = join(base, entry.name);
      const info = await lstat(path).catch(() => null);
      if (
        !info ||
        info.isSymbolicLink() ||
        info.mtimeMs > cutoff ||
        (typeof process.getuid === 'function' && info.uid !== process.getuid())
      ) continue;
      const resolved = await realpath(path).catch(() => '');
      if (!resolved.startsWith(`${base}/`)) continue;
      if (workerDirectory && info.isDirectory()) {
        await rm(path, { recursive: true, force: true });
      } else if (serverOutput && info.isFile()) {
        await unlink(path);
      } else {
        continue;
      }
      removed += 1;
    }
  }

  private pollMilliseconds() {
    const value = Number(this.config.get<string | number>('MEDIA_UPLOAD_WORKER_POLL_MS') ?? 2_000);
    return Number.isInteger(value) && value >= 250 && value <= 60_000 ? value : 2_000;
  }

  private async runMaintenance(label: string, action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      this.logMaintenanceFailure(label, error);
    }
  }

  private logMaintenanceFailure(label: string, error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    this.logger.warn(`Media ${label} failed: ${detail}`);
  }

  private boundedConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string | number>(key) ?? fallback);
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
}
