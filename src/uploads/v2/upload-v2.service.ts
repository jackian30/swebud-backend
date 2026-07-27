import {
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MediaProcessingJobStatus,
  MediaUploadSession,
  MediaUploadSessionStatus,
  Prisma,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { collectionFor, kindForMime } from '../media-library/collections';
import { MediaCollectionName } from '../media-library/types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CompleteUploadDto,
  CreateUploadSessionDto,
  MintUploadPartsDto,
} from './upload-v2.dto';
import { UploadException } from './upload-errors';
import {
  StoredUploadPart,
  UPLOAD_OBJECT_STORE,
  UploadObjectHead,
  UploadObjectStore,
} from './upload-object-store';
import { S3_MAX_PARTS, uploadPolicy } from './upload-policy';

const ACTIVE_STATUSES: MediaUploadSessionStatus[] = [
  'creating',
  'uploading',
  'completing',
  'queued',
  'processing',
];
const EXPIRABLE_STATUSES: MediaUploadSessionStatus[] = [
  'creating',
  'uploading',
];

const RESUMABLE_STATUSES: MediaUploadSessionStatus[] = ['uploading'];
const TERMINAL_STATUSES: MediaUploadSessionStatus[] = [
  'ready',
  'rejected',
  'failed',
  'cancelled',
  'expired',
];
type QuarantineCleanupOutcome = 'pending' | 'tombstoned' | 'cleaned';

@Injectable()
export class UploadV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(UPLOAD_OBJECT_STORE) private readonly objects: UploadObjectStore,
  ) {}

  async create(userId: string, dto: CreateUploadSessionDto) {
    this.validateDeclaration(dto);
    const policy = uploadPolicy(this.config);
    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.sessionTtlSeconds * 1000);
    const expectedPartCount = Math.ceil(dto.size / policy.partBytes);
    if (expectedPartCount > S3_MAX_PARTS) {
      throw new UploadException(
        HttpStatus.BAD_REQUEST,
        'UPLOAD_INVALID_DECLARATION',
        'Declared size requires too many multipart parts.',
      );
    }
    const quarantineBucket = this.storageCall(() => this.objects.quarantineBucket());
    const quarantineKey = `quarantine/v2/${userId}/${id}/${randomBytes(24).toString('hex')}`;

    const reservation = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const duplicate = dto.idempotencyKey
        ? await tx.mediaUploadSession.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: dto.idempotencyKey } },
        })
        : null;
      if (duplicate) {
        this.assertSameDeclaration(duplicate, dto);
        return { session: duplicate, replayed: true as const };
      }
      const activeCount = await tx.mediaUploadSession.count({
        where: { userId, status: { in: ACTIVE_STATUSES } },
      });
      if (activeCount >= policy.activeUploadsPerUser) {
        throw new UploadException(
          HttpStatus.TOO_MANY_REQUESTS,
          'UPLOAD_CONCURRENCY_EXCEEDED',
          'Too many active uploads. Complete or cancel an existing upload first.',
          true,
        );
      }
      const quotaSince = new Date(now.getTime() - policy.rollingQuotaHours * 60 * 60 * 1000);
      const rolling = await tx.mediaUploadSession.aggregate({
        where: { userId, createdAt: { gte: quotaSince } },
        _sum: { declaredSize: true },
      });
      if ((rolling._sum.declaredSize ?? 0) + dto.size > policy.rollingQuotaBytes) {
        throw new UploadException(
          HttpStatus.TOO_MANY_REQUESTS,
          'UPLOAD_QUOTA_EXCEEDED',
          'Rolling upload byte quota exceeded. Retry after older reservations expire.',
          true,
        );
      }
      const created = await tx.mediaUploadSession.create({
        data: {
          id,
          userId,
          idempotencyKey: dto.idempotencyKey,
          collection: dto.collection,
          declaredMimeType: dto.mimeType,
          declaredSize: dto.size,
          declaredSha256: dto.sha256,
          quarantineBucket,
          quarantineKey,
          partSize: policy.partBytes,
          expectedPartCount,
          expiresAt,
          status: 'creating',
        },
      });
      return { session: created, replayed: false as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const session = reservation.session;
    if (reservation.replayed) return this.sessionResponse(session);

    let uploadId: string;
    try {
      const created = await this.objects.createMultipart({
        bucket: session.quarantineBucket,
        key: session.quarantineKey,
        contentType: session.declaredMimeType,
        metadata: {
          'upload-session-id': session.id,
          'owner-id': session.userId,
          'declared-size': String(session.declaredSize),
          collection: session.collection,
        },
      });
      uploadId = created.uploadId;
    } catch {
      await this.prisma.mediaUploadSession.updateMany({
        where: { id: session.id, status: 'creating' },
        data: {
          status: 'failed',
          failureCode: 'UPLOAD_STORAGE_UNAVAILABLE',
          failureMessage: 'Could not initialize quarantine storage.',
        },
      }).catch(() => undefined);
      throw this.storageUnavailable();
    }

    let claimed: { count: number };
    try {
      claimed = await this.prisma.mediaUploadSession.updateMany({
        where: { id: session.id, userId, status: 'creating' },
        data: { providerUploadId: uploadId, status: 'uploading' },
      });
    } catch {
      // The claim response is ambiguous: it may have committed before the DB
      // connection failed. Only clean storage if a second conditional write
      // proves the row is still creating or is already terminal. Never abort a
      // provider id that may now belong to an `uploading` row.
      const failedCreating = await this.prisma.mediaUploadSession.updateMany({
        where: { id: session.id, userId, status: 'creating' },
        data: {
          providerUploadId: uploadId,
          status: 'failed',
          failureCode: 'UPLOAD_STORAGE_UNAVAILABLE',
          failureMessage: 'Could not initialize quarantine storage.',
        },
      }).catch(() => ({ count: 0 }));
      const terminal = failedCreating.count
        ? { count: 0 }
        : await this.prisma.mediaUploadSession.updateMany({
          where: {
            id: session.id,
            status: { in: ['cancelled', 'expired', 'failed', 'rejected'] },
          },
          data: {
            providerUploadId: uploadId,
            quarantineCleanupStartedAt: null,
            quarantineDeletedAt: null,
          },
        }).catch(() => ({ count: 0 }));
      if (failedCreating.count || terminal.count) {
        await this.cleanupAndRecordQuarantine({
          id: session.id,
          providerUploadId: uploadId,
          quarantineBucket: session.quarantineBucket,
          quarantineKey: session.quarantineKey,
          quarantineCleanupStartedAt: null,
        }, ['cancelled', 'expired', 'failed', 'rejected']);
      }
      throw this.storageUnavailable();
    }

    if (!claimed.count) {
      // Cancellation/expiry can win while CreateMultipartUpload is in flight.
      // Persist the provider id before cleanup so a transient S3 failure remains
      // recoverable by the bounded maintenance pass.
      await this.prisma.mediaUploadSession.updateMany({
        where: {
          id: session.id,
          status: { in: ['cancelled', 'expired', 'failed', 'rejected'] },
        },
        data: {
          providerUploadId: uploadId,
          quarantineCleanupStartedAt: null,
          quarantineDeletedAt: null,
        },
      });
      await this.cleanupAndRecordQuarantine({
        id: session.id,
        providerUploadId: uploadId,
        quarantineBucket: session.quarantineBucket,
        quarantineKey: session.quarantineKey,
        quarantineCleanupStartedAt: null,
      }, ['cancelled', 'expired', 'failed', 'rejected']);
      const current = await this.ownedSession(userId, session.id, true);
      return this.sessionResponse(current);
    }
    // Keep the response reload outside all storage-init compensation catches:
    // a transient read failure must never abort an upload already claimed by
    // the database as `uploading`.
    const updated = await this.ownedSession(userId, session.id, true);
    return this.sessionResponse(updated);
  }

  async mintParts(userId: string, sessionId: string, dto: MintUploadPartsDto) {
    const session = await this.ownedSession(userId, sessionId);
    await this.assertResumable(session);
    const ordered = [...dto.parts].sort((a, b) => a.partNumber - b.partNumber);
    this.assertConsecutive(ordered.map((part) => part.partNumber), false);
    if (ordered.some((part) => part.partNumber > session.expectedPartCount)) {
      throw this.invalidParts('Requested part number is outside the declared upload.');
    }
    const policy = uploadPolicy(this.config);
    const remainingSeconds = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
    const expiresInSeconds = Math.min(policy.urlTtlSeconds, remainingSeconds);
    if (expiresInSeconds < 60) {
      await this.expireSession(session);
      throw this.expired();
    }
    const urls = await Promise.all(ordered.map(async (part) => ({
      partNumber: part.partNumber,
      url: await this.storageCallAsync(() => this.objects.presignPart({
        bucket: session.quarantineBucket,
        key: session.quarantineKey,
        uploadId: session.providerUploadId!,
        partNumber: part.partNumber,
        checksumSha256: part.checksumSha256,
        contentLength: this.expectedPartSize(session, part.partNumber),
        expiresInSeconds,
      })),
      method: 'PUT' as const,
      requiredHeaders: {
        'x-amz-checksum-sha256': part.checksumSha256,
        'content-length': String(this.expectedPartSize(session, part.partNumber)),
      },
    })));
    return {
      sessionId: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
      urlsExpireAt: new Date(Date.now() + expiresInSeconds * 1000),
      parts: urls,
    };
  }

  async progress(userId: string, sessionId: string) {
    const session = await this.ownedSession(userId, sessionId, true);
    let parts: StoredUploadPart[];
    if (
      TERMINAL_STATUSES.includes(session.status) ||
      ['completing', 'queued', 'processing'].includes(session.status)
    ) {
      parts = session.parts.map((part) => ({
        partNumber: part.partNumber,
        etag: part.etag,
        checksumSha256: part.checksumSha256,
        size: part.byteSize,
      }));
    } else {
      await this.assertResumable(session);
      parts = await this.storageCallAsync(() => this.objects.listParts({
        bucket: session.quarantineBucket,
        key: session.quarantineKey,
        uploadId: session.providerUploadId!,
      }));
    }
    const uploaded = new Set(parts.map((part) => part.partNumber));
    return {
      ...this.sessionResponse(session),
      progress: {
        uploadedBytes: parts.reduce((sum, part) => sum + part.size, 0),
        uploadedParts: parts.length,
        totalParts: session.expectedPartCount,
        missingPartNumbers: Array.from(
          { length: session.expectedPartCount },
          (_, index) => index + 1,
        ).filter((partNumber) => !uploaded.has(partNumber)),
        parts,
      },
    };
  }

  async complete(userId: string, sessionId: string, dto: CompleteUploadDto) {
    let session = await this.ownedSession(userId, sessionId, true);
    if (['queued', 'processing', 'ready'].includes(session.status)) return this.sessionResponse(session);
    if (TERMINAL_STATUSES.includes(session.status)) {
      throw new UploadException(
        HttpStatus.CONFLICT,
        'UPLOAD_INVALID_STATE',
        `Upload cannot be completed from status ${session.status}.`,
      );
    }
    await this.assertNotExpired(session);
    if (!session.providerUploadId) throw this.invalidState('Multipart upload is not initialized.');

    const ordered = [...dto.parts].sort((a, b) => a.partNumber - b.partNumber);
    this.assertConsecutive(ordered.map((part) => part.partNumber), true);
    if (ordered.length !== session.expectedPartCount) {
      throw this.invalidParts('Completion must include every declared part exactly once.');
    }
    const policy = uploadPolicy(this.config);
    let uploaded: StoredUploadPart[] | undefined;
    let completionClaimId = session.completionClaimId;

    if (session.status === 'completing') {
      if (!completionClaimId) {
        throw this.invalidState('Completing upload is missing its fencing token.');
      }
      const explicitlyRecoverable = session.failureCode === 'UPLOAD_COMPLETION_AMBIGUOUS';
      const stale = session.updatedAt.getTime() <=
        Date.now() - policy.completionStaleSeconds * 1000;
      if (!explicitlyRecoverable && !stale) return this.sessionResponse(session);

      let recoveredHead: UploadObjectHead | null;
      try {
        recoveredHead = await this.objects.headQuarantine({
          bucket: session.quarantineBucket,
          key: session.quarantineKey,
        });
      } catch {
        return this.throwCompletionUnavailableOrState(userId, session);
      }
      if (recoveredHead) {
        if (!this.validHead(session, recoveredHead)) {
          return this.rejectCompletedIntegrity(userId, session);
        }
        uploaded = this.recoveryParts(session, ordered);
        return this.finalizeCompletion(
          userId,
          session,
          uploaded,
          recoveredHead,
          {},
        );
      }

      try {
        uploaded = await this.objects.listParts({
          bucket: session.quarantineBucket,
          key: session.quarantineKey,
          uploadId: session.providerUploadId,
        });
        this.verifyParts(session, ordered, uploaded);
      } catch (error) {
        if (error instanceof UploadException) {
          await this.resetCompletion(session.id, completionClaimId);
          throw error;
        }
        return this.throwCompletionUnavailableOrState(userId, session);
      }
      const reset = await this.resetCompletion(session.id, completionClaimId);
      if (!reset) {
        const current = await this.ownedSession(userId, session.id, true);
        if (['queued', 'processing', 'ready'].includes(current.status)) return this.sessionResponse(current);
        throw this.invalidState(`Upload recovery lost to ${current.status}.`);
      }
      session = {
        ...session,
        status: 'uploading',
        completionClaimId: null,
        failureCode: null,
        failureMessage: null,
      };
    }

    completionClaimId = randomUUID();
    const claimed = await this.prisma.mediaUploadSession.updateMany({
      where: { id: session.id, userId, status: 'uploading' },
      data: {
        status: 'completing',
        completionClaimId,
        failureCode: null,
        failureMessage: null,
      },
    });
    if (!claimed.count) {
      session = await this.ownedSession(userId, sessionId, true);
      if (['queued', 'processing', 'ready'].includes(session.status)) return this.sessionResponse(session);
      if (session.status === 'completing') return this.sessionResponse(session);
      throw this.invalidState(`Upload cannot be completed from status ${session.status}.`);
    } else {
      session = {
        ...session,
        status: 'completing',
        completionClaimId,
        failureCode: null,
        failureMessage: null,
        updatedAt: new Date(),
      };
    }

    try {
      uploaded ??= await this.storageCallAsync(() => this.objects.listParts({
        bucket: session.quarantineBucket,
        key: session.quarantineKey,
        uploadId: session.providerUploadId!,
      }));
      this.verifyParts(session, ordered, uploaded);
    } catch (error) {
      await this.resetCompletion(session.id, completionClaimId);
      throw error;
    }
    if (!await this.persistCompletionParts(session.id, completionClaimId, uploaded)) {
      const current = await this.ownedSession(userId, session.id, true);
      throw this.invalidState(`Upload part persistence lost to ${current.status}.`);
    }

    let completed: { etag?: string; checksumSha256?: string } = {};
    let completionFailed = false;
    try {
      completed = await this.objects.completeMultipart({
        bucket: session.quarantineBucket,
        key: session.quarantineKey,
        uploadId: session.providerUploadId!,
        parts: uploaded,
      });
    } catch {
      completionFailed = true;
    }

    let head: UploadObjectHead | null;
    try {
      head = await this.objects.headQuarantine({
        bucket: session.quarantineBucket,
        key: session.quarantineKey,
      });
    } catch {
      return this.throwCompletionUnavailableOrState(userId, session);
    }
    if (!head && completionFailed) {
      try {
        // A successful ListParts proves CompleteMultipart did not consume the
        // upload id, so retrying from `uploading` is safe. Any ListParts error
        // remains ambiguous (including NoSuchUpload) and is reconciled by HEAD.
        await this.objects.listParts({
          bucket: session.quarantineBucket,
          key: session.quarantineKey,
          uploadId: session.providerUploadId!,
        });
        await this.resetCompletion(session.id, completionClaimId);
      } catch {
        return this.throwCompletionUnavailableOrState(userId, session);
      }
      throw this.storageUnavailable();
    }
    if (!head) {
      return this.throwCompletionUnavailableOrState(userId, session);
    }
    if (!this.validHead(session, head)) {
      return this.rejectCompletedIntegrity(userId, session);
    }
    return this.finalizeCompletion(userId, session, uploaded, head, completed);
  }

  private async persistCompletionParts(
    sessionId: string,
    completionClaimId: string,
    uploaded: StoredUploadPart[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; completionClaimId: string | null }>>(Prisma.sql`
        SELECT
          "status"::text AS "status",
          "completion_claim_id"::text AS "completionClaimId"
        FROM "media_upload_sessions"
        WHERE "id" = ${sessionId}::uuid
        FOR UPDATE
      `);
      if (
        locked[0]?.status !== 'completing' ||
        locked[0]?.completionClaimId !== completionClaimId
      ) return false;
      for (const part of uploaded) {
        await tx.mediaUploadPart.upsert({
          where: { sessionId_partNumber: { sessionId, partNumber: part.partNumber } },
          create: {
            sessionId,
            partNumber: part.partNumber,
            etag: part.etag,
            checksumSha256: part.checksumSha256,
            byteSize: part.size,
          },
          update: {
            etag: part.etag,
            checksumSha256: part.checksumSha256,
            byteSize: part.size,
          },
        });
      }
      return true;
    });
  }

  private recoveryParts(
    session: Awaited<ReturnType<UploadV2Service['ownedSession']>>,
    requested: CompleteUploadDto['parts'],
  ): StoredUploadPart[] {
    if (session.parts?.length === session.expectedPartCount) {
      const stored = session.parts.map((part) => ({
        partNumber: part.partNumber,
        etag: part.etag,
        checksumSha256: part.checksumSha256,
        size: part.byteSize,
      }));
      this.verifyParts(session, requested, stored);
      return stored;
    }
    return requested.map((part) => ({
      ...part,
      size: this.expectedPartSize(session, part.partNumber),
    }));
  }

  private async finalizeCompletion(
    userId: string,
    session: Awaited<ReturnType<UploadV2Service['ownedSession']>>,
    uploaded: StoredUploadPart[],
    head: UploadObjectHead,
    completed: { etag?: string; checksumSha256?: string },
  ) {
    const policy = uploadPolicy(this.config);
    const finalized = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; completionClaimId: string | null }>>(Prisma.sql`
        SELECT
          "status"::text AS "status",
          "completion_claim_id"::text AS "completionClaimId"
        FROM "media_upload_sessions"
        WHERE "id" = ${session.id}::uuid
        FOR UPDATE
      `);
      if (
        locked[0]?.status !== 'completing' ||
        locked[0]?.completionClaimId !== session.completionClaimId
      ) return null;
      for (const part of uploaded) {
        await tx.mediaUploadPart.upsert({
          where: { sessionId_partNumber: { sessionId: session.id, partNumber: part.partNumber } },
          create: {
            sessionId: session.id,
            partNumber: part.partNumber,
            etag: part.etag,
            checksumSha256: part.checksumSha256,
            byteSize: part.size,
          },
          update: {
            etag: part.etag,
            checksumSha256: part.checksumSha256,
            byteSize: part.size,
          },
        });
      }
      await tx.mediaAsset.upsert({
        where: { sessionId: session.id },
        create: {
          sessionId: session.id,
          userId,
          collection: session.collection,
          status: 'quarantined',
          mimeType: session.declaredMimeType,
          byteSize: session.declaredSize,
        },
        update: {},
      });
      await tx.mediaProcessingJob.upsert({
        where: { sessionId: session.id },
        create: {
          sessionId: session.id,
          status: 'pending',
          maxAttempts: policy.jobMaxAttempts,
        },
        update: {},
      });
      return tx.mediaUploadSession.update({
        where: { id: session.id },
        data: {
          status: 'queued',
          completionClaimId: null,
          objectEtag: head.etag ?? completed.etag,
          objectChecksumSha256: head.checksumSha256 ?? completed.checksumSha256,
          completedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
        include: { asset: true, parts: { orderBy: { partNumber: 'asc' } } },
      });
    });
    if (!finalized) {
      const current = await this.ownedSession(userId, session.id, true);
      if (['queued', 'processing', 'ready'].includes(current.status)) {
        return this.sessionResponse(current);
      }
      if (['cancelled', 'expired', 'failed', 'rejected'].includes(current.status)) {
        await this.cleanupAndRecordQuarantine(
          current,
          ['cancelled', 'expired', 'failed', 'rejected'],
        );
      }
      throw this.invalidState('Upload completion lost to cancellation or expiry.');
    }
    return this.sessionResponse(finalized);
  }

  private async rejectCompletedIntegrity(
    userId: string,
    session: Awaited<ReturnType<UploadV2Service['ownedSession']>>,
  ): Promise<never> {
    const rejected = await this.rejectIntegrity(
      session.id,
      session.completionClaimId,
      'Completed quarantine object failed size, metadata, MIME, or checksum verification.',
    );
    if (!rejected) {
      const current = await this.ownedSession(userId, session.id, true);
      if (['cancelled', 'expired', 'failed', 'rejected'].includes(current.status)) {
        await this.cleanupAndRecordQuarantine(
          current,
          ['cancelled', 'expired', 'failed', 'rejected'],
        );
      }
      throw this.invalidState(`Upload completion lost to ${current.status}.`);
    }
    await this.cleanupAndRecordQuarantine(session, ['rejected']);
    throw new UploadException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'UPLOAD_INTEGRITY_FAILED',
      'Completed object does not match the upload declaration.',
    );
  }

  private async resetCompletion(sessionId: string, completionClaimId: string) {
    const reset = await this.prisma.mediaUploadSession.updateMany({
      where: { id: sessionId, status: 'completing', completionClaimId },
      data: {
        status: 'uploading',
        completionClaimId: null,
        failureCode: null,
        failureMessage: null,
      },
    });
    return reset.count > 0;
  }

  private async markCompletionAmbiguous(sessionId: string, completionClaimId: string) {
    const marked = await this.prisma.mediaUploadSession.updateMany({
      where: { id: sessionId, status: 'completing', completionClaimId },
      data: {
        failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS',
        failureMessage: 'Multipart completion outcome is being reconciled.',
      },
    });
    return marked.count > 0;
  }

  private async throwCompletionUnavailableOrState(
    userId: string,
    session: Awaited<ReturnType<UploadV2Service['ownedSession']>>,
  ): Promise<never> {
    if (
      session.completionClaimId &&
      await this.markCompletionAmbiguous(session.id, session.completionClaimId)
    ) throw this.storageUnavailable();
    const current = await this.ownedSession(userId, session.id, true);
    if (['cancelled', 'expired', 'failed', 'rejected'].includes(current.status)) {
      await this.cleanupAndRecordQuarantine(
        current,
        ['cancelled', 'expired', 'failed', 'rejected'],
      );
    }
    throw this.invalidState(`Upload completion lost to ${current.status}.`);
  }

  async status(userId: string, sessionId: string) {
    let session = await this.ownedSession(userId, sessionId, true);
    if (session.status === 'completing') {
      const policy = uploadPolicy(this.config);
      const recoverable = (
        session.failureCode === 'UPLOAD_COMPLETION_AMBIGUOUS' ||
        session.updatedAt.getTime() <= Date.now() - policy.completionStaleSeconds * 1000
      );
      if (recoverable) {
        const head = await this.objects.headQuarantine({
          bucket: session.quarantineBucket,
          key: session.quarantineKey,
        }).catch(() => undefined);
        const stored = session.parts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag,
          checksumSha256: part.checksumSha256,
          size: part.byteSize,
        }));
        if (
          head &&
          this.validHead(session, head) &&
          stored.length === session.expectedPartCount
        ) {
          return this.finalizeCompletion(userId, session, stored, head, {});
        }
        if (
          head &&
          !this.validHead(session, head) &&
          session.completionClaimId
        ) {
          const rejected = await this.rejectIntegrity(
            session.id,
            session.completionClaimId,
            'Completed quarantine object failed size, metadata, MIME, or checksum verification.',
          );
          if (rejected) {
            await this.cleanupAndRecordQuarantine(session, ['rejected']);
          }
          const current = await this.ownedSession(userId, sessionId, true);
          if (
            !rejected &&
            ['cancelled', 'expired', 'failed', 'rejected'].includes(current.status)
          ) {
            await this.cleanupAndRecordQuarantine(
              current,
              ['cancelled', 'expired', 'failed', 'rejected'],
            );
          }
          return this.sessionResponse(current);
        }
        if (head === null) {
          const multipartExists = await this.objects.listParts({
            bucket: session.quarantineBucket,
            key: session.quarantineKey,
            uploadId: session.providerUploadId!,
          }).then(() => true).catch(() => false);
          if (multipartExists && session.completionClaimId) {
            await this.resetCompletion(session.id, session.completionClaimId);
            session = await this.ownedSession(userId, sessionId, true);
          }
        }
      }
    }
    if (EXPIRABLE_STATUSES.includes(session.status) && session.expiresAt.getTime() <= Date.now()) {
      await this.expireSession(session);
      return this.sessionResponse(await this.ownedSession(userId, sessionId, true));
    }
    return this.sessionResponse(session);
  }

  async cancel(userId: string, sessionId: string) {
    const session = await this.ownedSession(userId, sessionId, true);
    if (session.status === 'cancelled') return this.sessionResponse(session);
    if (session.status === 'ready') {
      throw this.invalidState('A ready media asset cannot be cancelled through the upload API.');
    }
    const claimed = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.mediaUploadSession.updateMany({
        where: {
          id: session.id,
          userId,
          status: { notIn: ['ready', 'cancelled'] },
        },
        data: {
          status: 'cancelled',
          completionClaimId: null,
          cancelledAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      });
      if (!transition.count) return false;
      await tx.mediaProcessingJob.updateMany({
        where: {
          sessionId: session.id,
          status: { in: ['pending', 'retry_wait', 'leased'] as MediaProcessingJobStatus[] },
        },
        data: {
          status: 'cancelled',
          leaseOwner: null,
          leasedAt: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
        },
      });
      await tx.mediaAsset.updateMany({
        where: { sessionId: session.id, status: { in: ['quarantined', 'processing'] } },
        data: {
          status: 'rejected',
          failureCode: 'UPLOAD_CANCELLED',
          failureMessage: 'Upload cancelled by owner.',
        },
      });
      return true;
    });
    if (!claimed) {
      const current = await this.ownedSession(userId, sessionId, true);
      if (current.status === 'cancelled') return this.sessionResponse(current);
      throw this.invalidState('Upload completed before cancellation could be claimed.');
    }
    await this.cleanupCancelledStorage(session);
    const updated = await this.ownedSession(userId, sessionId, true);
    return this.sessionResponse(updated);
  }

  async cleanupExpired(limit = 100) {
    const sessions = await this.prisma.mediaUploadSession.findMany({
      where: {
        OR: [
          {
            status: { in: EXPIRABLE_STATUSES },
            expiresAt: { lte: new Date() },
          },
          {
            status: 'expired',
            quarantineDeletedAt: null,
          },
        ],
      },
      orderBy: { expiresAt: 'asc' },
      take: Math.max(1, Math.min(limit, 500)),
    });
    const results = await this.mapConcurrent(sessions, 5, async (session) => {
      if (session.status === 'expired') {
        return this.cleanupAndRecordQuarantine(session, ['expired']);
      }
      return this.expireSession(session);
    });
    return results.filter(Boolean).length;
  }

  async reconcileStaleCompletions(limit = 100) {
    const cutoff = new Date(
      Date.now() - uploadPolicy(this.config).completionStaleSeconds * 1000,
    );
    const sessions = await this.prisma.mediaUploadSession.findMany({
      where: {
        status: 'completing',
        OR: [
          { failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS' },
          { updatedAt: { lte: cutoff } },
        ],
      },
      select: { id: true, userId: true },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(1, Math.min(limit, 500)),
    });
    const results = await this.mapConcurrent(sessions, 5, async (session) => {
      try {
        await this.status(session.userId, session.id);
        return true;
      } catch {
        return false;
      }
    });
    return results.filter(Boolean).length;
  }

  async cleanupCancelled(limit = 100) {
    const sessions = await this.prisma.mediaUploadSession.findMany({
      where: {
        status: 'cancelled',
        OR: [
          { quarantineDeletedAt: null },
          { asset: { is: { status: 'rejected', publicKey: { not: null } } } },
        ],
      },
      include: { asset: true },
      orderBy: { cancelledAt: 'asc' },
      take: Math.max(1, Math.min(limit, 500)),
    });
    const results = await this.mapConcurrent(
      sessions,
      5,
      (session) => this.cleanupCancelledStorage(session),
    );
    return results.filter(Boolean).length;
  }

  async cleanupTerminal(limit = 100) {
    const sessions = await this.prisma.mediaUploadSession.findMany({
      where: {
        status: { in: ['failed', 'rejected'] },
        quarantineDeletedAt: null,
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(1, Math.min(limit, 500)),
    });
    const results = await this.mapConcurrent(
      sessions,
      5,
      (session) => this.cleanupAndRecordQuarantine(session, ['failed', 'rejected']),
    );
    return results.filter(Boolean).length;
  }

  private validateDeclaration(dto: CreateUploadSessionDto) {
    const collection = collectionFor(dto.collection as MediaCollectionName);
    const kind = kindForMime(dto.mimeType);
    if (!kind || (collection.accepts !== 'media' && collection.accepts !== kind)) {
      throw new UploadException(
        HttpStatus.BAD_REQUEST,
        'UPLOAD_INVALID_DECLARATION',
        'Declared MIME type is not accepted by the selected collection.',
      );
    }
    if (dto.size > collection.maxBytes) {
      throw new UploadException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'UPLOAD_INVALID_DECLARATION',
        'Declared size exceeds the selected collection limit.',
      );
    }
  }

  private assertSameDeclaration(session: MediaUploadSession, dto: CreateUploadSessionDto) {
    if (
      session.collection !== dto.collection ||
      session.declaredMimeType !== dto.mimeType ||
      session.declaredSize !== dto.size ||
      session.declaredSha256 !== (dto.sha256 ?? null)
    ) {
      throw new ConflictException({
        code: 'UPLOAD_IDEMPOTENCY_CONFLICT',
        message: 'The idempotency key was already used for a different upload declaration.',
        retryable: false,
      });
    }
  }

  private async ownedSession(userId: string, sessionId: string, includeRelations = false) {
    const session = await this.prisma.mediaUploadSession.findUnique({
      where: { id: sessionId },
      ...(includeRelations
        ? { include: { asset: true, parts: { orderBy: { partNumber: 'asc' as const } } } }
        : {}),
    });
    if (!session || session.userId !== userId) {
      throw new UploadException(
        HttpStatus.NOT_FOUND,
        'UPLOAD_NOT_FOUND',
        'Upload session was not found.',
      );
    }
    return session as typeof session & {
      asset?: {
        id: string;
        status: string;
        publicUrl: string | null;
        mimeType: string;
        byteSize: number;
        width: number | null;
        height: number | null;
        durationSeconds: number | null;
        failureCode: string | null;
        failureMessage: string | null;
        publicBucket?: string | null;
        publicKey?: string | null;
      } | null;
      parts: Array<{
        partNumber: number;
        etag: string;
        checksumSha256: string;
        byteSize: number;
      }>;
    };
  }

  private async assertResumable(session: MediaUploadSession) {
    await this.assertNotExpired(session);
    if (!RESUMABLE_STATUSES.includes(session.status) || !session.providerUploadId) {
      throw this.invalidState(`Upload cannot accept parts from status ${session.status}.`);
    }
  }

  private async assertNotExpired(session: MediaUploadSession) {
    if (!EXPIRABLE_STATUSES.includes(session.status)) return;
    if (session.expiresAt.getTime() > Date.now()) return;
    const expired = await this.expireSession(session);
    if (!expired) throw this.invalidState('Upload state changed while expiry was being claimed.');
    throw this.expired();
  }

  private async expireSession(session: MediaUploadSession) {
    const claimed = await this.prisma.mediaUploadSession.updateMany({
      where: { id: session.id, status: { in: EXPIRABLE_STATUSES } },
      data: {
        status: 'expired',
        completionClaimId: null,
        failureCode: 'UPLOAD_EXPIRED',
        failureMessage: 'Upload session expired before completion.',
      },
    });
    if (!claimed.count) return false;
    await this.cleanupAndRecordQuarantine(session, ['expired']);
    return true;
  }

  private async cleanupCancelledStorage(session: MediaUploadSession & {
    asset?: { publicBucket?: string | null; publicKey?: string | null } | null;
  }) {
    const quarantineCleaned = await this.cleanupAndRecordQuarantine(session, ['cancelled']);
    if (session.asset?.publicBucket && session.asset.publicKey) {
      await this.objects.deletePublished(
        session.asset.publicBucket,
        session.asset.publicKey,
      ).then(async () => {
        await this.prisma.mediaAsset.updateMany({
          where: { sessionId: session.id, status: 'rejected' },
          data: { publicBucket: null, publicKey: null, publicUrl: null },
        });
      }).catch(() => undefined);
    }
    return quarantineCleaned;
  }

  private async cleanupAndRecordQuarantine(
    session: Pick<
      MediaUploadSession,
      | 'id'
      | 'providerUploadId'
      | 'quarantineBucket'
      | 'quarantineKey'
      | 'quarantineCleanupStartedAt'
    >,
    statuses: MediaUploadSessionStatus[],
  ) {
    const outcome = await this.cleanupQuarantineStorage(session);
    if (outcome === 'tombstoned') {
      await this.prisma.mediaUploadSession.updateMany({
        where: {
          id: session.id,
          status: { in: statuses },
          quarantineCleanupStartedAt: null,
          quarantineDeletedAt: null,
        },
        data: { quarantineCleanupStartedAt: new Date() },
      });
      return false;
    }
    if (outcome !== 'cleaned') return false;
    await this.prisma.mediaUploadSession.updateMany({
      where: {
        id: session.id,
        status: { in: statuses },
        quarantineDeletedAt: null,
      },
      data: { quarantineDeletedAt: new Date() },
    });
    return true;
  }

  private async mapConcurrent<T, R>(
    items: T[],
    concurrency: number,
    action: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let index = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (index < items.length) {
          const current = index;
          index += 1;
          results[current] = await action(items[current]);
        }
      },
    );
    await Promise.all(workers);
    return results;
  }

  private async cleanupQuarantineStorage(session: Pick<
    MediaUploadSession,
    | 'providerUploadId'
    | 'quarantineBucket'
    | 'quarantineKey'
    | 'quarantineCleanupStartedAt'
  >): Promise<QuarantineCleanupOutcome> {
    if (session.providerUploadId) {
      const tombstoneSeconds = uploadPolicy(this.config).quarantineCleanupTombstoneSeconds;
      if (
        session.quarantineCleanupStartedAt &&
        session.quarantineCleanupStartedAt.getTime() >
          Date.now() - tombstoneSeconds * 1000
      ) {
        return 'pending';
      }
      // Abort first, then still verify/delete the object: CompleteMultipart and
      // AbortMultipart can race, so an apparently successful abort is not proof
      // that no completed object exists.
      try {
        await this.objects.abortMultipart({
          bucket: session.quarantineBucket,
          key: session.quarantineKey,
          uploadId: session.providerUploadId,
        });
      } catch {
        // A missing HeadObject says nothing about an in-progress multipart
        // upload. Keep cleanup pending unless abort was confirmed or the
        // gateway classified the response as NoSuchUpload.
        return 'pending';
      }
      try {
        const object = {
          bucket: session.quarantineBucket,
          key: session.quarantineKey,
        };
        const head = await this.objects.headQuarantine(object);
        if (head) await this.objects.deleteQuarantine(object);
        return session.quarantineCleanupStartedAt ? 'cleaned' : 'tombstoned';
      } catch {
        return 'pending';
      }
    }
    try {
      const object = {
        bucket: session.quarantineBucket,
        key: session.quarantineKey,
      };
      await this.objects.deleteQuarantine(object);
      return 'cleaned';
    } catch {
      try {
        const object = {
          bucket: session.quarantineBucket,
          key: session.quarantineKey,
        };
        const head = await this.objects.headQuarantine(object);
        if (!head) return 'cleaned';
        await this.objects.deleteQuarantine(object);
        return 'cleaned';
      } catch {
        return 'pending';
      }
    }
  }

  private assertConsecutive(partNumbers: number[], mustStartAtOne: boolean) {
    const unique = new Set(partNumbers);
    const expectedStart = mustStartAtOne ? 1 : partNumbers[0];
    if (
      unique.size !== partNumbers.length ||
      expectedStart == null ||
      partNumbers.some((partNumber, index) => partNumber !== expectedStart + index)
    ) {
      throw this.invalidParts(
        mustStartAtOne
          ? 'Part numbers must be unique and consecutive beginning with 1.'
          : 'Requested part numbers must be unique and consecutive.',
      );
    }
  }

  private verifyParts(
    session: MediaUploadSession,
    requested: CompleteUploadDto['parts'],
    uploaded: StoredUploadPart[],
  ) {
    if (uploaded.length !== session.expectedPartCount) {
      throw this.invalidParts('S3 does not contain every declared part.');
    }
    this.assertConsecutive(uploaded.map((part) => part.partNumber), true);
    for (let index = 0; index < uploaded.length; index += 1) {
      const actual = uploaded[index];
      const expected = requested[index];
      const expectedSize = this.expectedPartSize(session, actual.partNumber);
      if (
        actual.size !== expectedSize ||
        actual.checksumSha256 !== expected.checksumSha256 ||
        this.normalizeEtag(actual.etag) !== this.normalizeEtag(expected.etag)
      ) {
        throw this.invalidParts(`Uploaded part ${actual.partNumber} does not match its completion record.`);
      }
    }
  }

  private expectedPartSize(
    session: Pick<MediaUploadSession, 'declaredSize' | 'partSize' | 'expectedPartCount'>,
    partNumber: number,
  ) {
    return partNumber === session.expectedPartCount
      ? session.declaredSize - session.partSize * (partNumber - 1)
      : session.partSize;
  }

  private validHead(session: MediaUploadSession, head: {
    size: number;
    contentType?: string;
    checksumSha256?: string;
    checksumType?: string;
    metadata: Record<string, string>;
  }) {
    return (
      head.size === session.declaredSize &&
      head.contentType === session.declaredMimeType &&
      Boolean(head.checksumSha256) &&
      (!head.checksumType || head.checksumType === 'COMPOSITE') &&
      head.metadata['upload-session-id'] === session.id &&
      head.metadata['owner-id'] === session.userId &&
      head.metadata['declared-size'] === String(session.declaredSize) &&
      head.metadata.collection === session.collection
    );
  }

  private async rejectIntegrity(
    sessionId: string,
    completionClaimId: string | null,
    message: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{
        status: string;
        completionClaimId: string | null;
      }>>(Prisma.sql`
        SELECT
          "status"::text AS "status",
          "completion_claim_id"::text AS "completionClaimId"
        FROM "media_upload_sessions"
        WHERE "id" = ${sessionId}::uuid
        FOR UPDATE
      `);
      if (
        locked[0]?.status !== 'completing' ||
        locked[0]?.completionClaimId !== completionClaimId
      ) return false;
      await tx.mediaUploadSession.update({
        where: { id: sessionId },
        data: {
          status: 'rejected',
          completionClaimId: null,
          failureCode: 'UPLOAD_INTEGRITY_FAILED',
          failureMessage: message,
        },
      });
      await tx.mediaAsset.updateMany({
        where: { sessionId },
        data: { status: 'rejected', failureCode: 'UPLOAD_INTEGRITY_FAILED', failureMessage: message },
      });
      return true;
    });
  }

  private sessionResponse(session: {
    id: string;
    collection: string;
    declaredMimeType: string;
    declaredSize: number;
    partSize: number;
    expectedPartCount: number;
    status: MediaUploadSessionStatus;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    failureCode?: string | null;
    failureMessage?: string | null;
    asset?: {
      id: string;
      status: string;
      publicUrl: string | null;
      mimeType: string;
      byteSize: number;
      width: number | null;
      height: number | null;
      durationSeconds: number | null;
      failureCode: string | null;
      failureMessage: string | null;
    } | null;
  }) {
    return {
      id: session.id,
      collection: session.collection,
      declaredMimeType: session.declaredMimeType,
      declaredSize: session.declaredSize,
      partSize: session.partSize,
      expectedPartCount: session.expectedPartCount,
      status: session.status,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      error: session.failureCode
        ? {
          code: session.failureCode,
          message: session.failureMessage ?? 'Upload failed.',
          retryable: session.status === 'failed',
        }
        : null,
      asset: session.asset
        ? {
          id: session.asset.id,
          status: session.asset.status,
          url: session.asset.publicUrl,
          mimeType: session.asset.mimeType,
          size: session.asset.byteSize,
          width: session.asset.width,
          height: session.asset.height,
          durationSeconds: session.asset.durationSeconds,
          error: session.asset.failureCode
            ? {
              code: session.asset.failureCode,
              message: session.asset.failureMessage ?? 'Media processing failed.',
              retryable: false,
            }
            : null,
        }
        : null,
    };
  }

  private normalizeEtag(etag: string) {
    return etag.trim().replace(/^"|"$/g, '');
  }

  private invalidParts(message: string) {
    return new UploadException(HttpStatus.BAD_REQUEST, 'UPLOAD_INVALID_PARTS', message);
  }

  private invalidState(message: string) {
    return new UploadException(HttpStatus.CONFLICT, 'UPLOAD_INVALID_STATE', message);
  }

  private expired() {
    return new UploadException(
      HttpStatus.GONE,
      'UPLOAD_EXPIRED',
      'Upload session has expired.',
    );
  }

  private storageUnavailable() {
    return new UploadException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'UPLOAD_STORAGE_UNAVAILABLE',
      'Upload storage is temporarily unavailable.',
      true,
    );
  }

  private storageCall<T>(call: () => T): T {
    try {
      return call();
    } catch {
      throw this.storageUnavailable();
    }
  }

  private async storageCallAsync<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof UploadException) throw error;
      throw this.storageUnavailable();
    }
  }
}
