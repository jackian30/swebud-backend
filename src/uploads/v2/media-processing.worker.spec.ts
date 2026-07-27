import { ConfigService } from '@nestjs/config';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { MediaPipelineError } from './malware-scanner';
import { MediaProcessingWorker } from './media-processing.worker';
import { UploadObjectStore } from './upload-object-store';

describe('MediaProcessingWorker concurrency', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'swebudd-worker-test-'));
    process.env.MEDIA_PROCESSING_TEMP_DIR = base;
  });

  afterEach(() => {
    delete process.env.MEDIA_PROCESSING_TEMP_DIR;
    rmSync(base, { recursive: true, force: true });
  });

  it('tombstones the public object when cancellation wins during publish and deletes all temp files', async () => {
    const state = workerState();
    const prisma = workerPrisma(state);
    const publish = deferred<{ bucket: string; key: string; url: string }>();
    const publishStarted = deferred<void>();
    const objects = objectStore();
    objects.downloadQuarantineToFile.mockImplementation(async ({ destinationPath }) => {
      await writeFile(destinationPath, Buffer.alloc(10), { mode: 0o600 });
    });
    objects.publishFromFile.mockImplementation(async () => {
      publishStarted.resolve();
      return publish.promise;
    });
    const pipeline = {
      process: jest.fn(async ({ path }: { path: string }) => {
        const output = join(dirname(path), 'output.webp');
        await writeFile(output, 'safe', { mode: 0o600 });
        return {
          path: output,
          filename: 'safe.webp',
          mimeType: 'image/webp',
          size: 4,
          type: 'image',
          temporary: true,
          inputSha256: Buffer.alloc(32).toString('base64'),
          width: 1,
          height: 1,
        };
      }),
    };
    const worker = createWorker(prisma, objects, pipeline);

    const processing = (worker as any).processJob(job());
    await publishStarted.promise;
    state.sessionStatus = 'cancelled';
    state.jobStatus = 'cancelled';
    const publishedKey = objects.publishFromFile.mock.calls[0][0].key;
    publish.resolve({ bucket: 'public-media', key: publishedKey, url: 'https://media.test/object' });
    await processing;

    expect(publishedKey).toMatch(/^images\/v2\/asset-1\/job-1-1-[0-9a-f-]+\.webp$/);
    expect(objects.deletePublished).not.toHaveBeenCalled();
    expect([...state.publishAttempts.values()]).toContain('cleanup_pending');
    expect(state.sessionStatus).toBe('cancelled');
    expect(readdirSync(base)).toEqual([]);
  });

  it('does not publish or mutate terminal state after losing its lease', async () => {
    const state = workerState();
    const prisma = workerPrisma(state);
    const processDeferred = deferred<any>();
    const pipelineStarted = deferred<void>();
    const objects = objectStore();
    objects.downloadQuarantineToFile.mockImplementation(async ({ destinationPath }) => {
      await writeFile(destinationPath, Buffer.alloc(10), { mode: 0o600 });
    });
    const pipeline = {
      process: jest.fn(() => {
        pipelineStarted.resolve();
        return processDeferred.promise;
      }),
    };
    const worker = createWorker(prisma, objects, pipeline);

    const processing = (worker as any).processJob(job());
    await pipelineStarted.promise;
    state.jobStatus = 'leased-by-another-worker';
    const output = join(base, 'safe.webp');
    await writeFile(output, 'safe', { mode: 0o600 });
    processDeferred.resolve({
      path: output,
      filename: 'safe.webp',
      mimeType: 'image/webp',
      size: 4,
      type: 'image',
      temporary: true,
      inputSha256: Buffer.alloc(32).toString('base64'),
    });
    await processing;

    expect(objects.publishFromFile).not.toHaveBeenCalled();
    expect(state.sessionStatus).toBe('processing');
    expect(state.assetStatus).toBe('processing');
  });

  it('fences overlapping attempts from the same worker id with unique publish keys', async () => {
    const state = workerState();
    const prisma = workerPrisma(state);
    const firstPublish = deferred<{ bucket: string; key: string; url: string }>();
    const secondPublish = deferred<{ bucket: string; key: string; url: string }>();
    const firstPublishStarted = deferred<void>();
    const secondPublishStarted = deferred<void>();
    const publishedKeys: string[] = [];
    const objects = objectStore();
    objects.downloadQuarantineToFile.mockImplementation(async ({ destinationPath }) => {
      await writeFile(destinationPath, Buffer.alloc(10), { mode: 0o600 });
    });
    objects.publishFromFile.mockImplementation(async (input) => {
      publishedKeys.push(input.key);
      if (publishedKeys.length === 1) {
        firstPublishStarted.resolve();
        return firstPublish.promise;
      }
      secondPublishStarted.resolve();
      return secondPublish.promise;
    });
    const pipeline = {
      process: jest.fn(async ({ path }: { path: string }) => {
        const output = join(dirname(path), 'output.webp');
        await writeFile(output, 'safe', { mode: 0o600 });
        return {
          path: output,
          filename: 'safe.webp',
          mimeType: 'image/webp',
          size: 4,
          type: 'image',
          temporary: true,
          inputSha256: Buffer.alloc(32).toString('base64'),
          width: 1,
          height: 1,
        };
      }),
    };
    const firstWorker = createWorker(prisma, objects, pipeline, {}, 'worker-1');
    const first = (firstWorker as any).processJob(job());
    await firstPublishStarted.promise;

    // Simulate the same process reclaiming its own expired lease while attempt
    // 1 is still publishing. workerId alone is not a fencing token.
    state.jobStatus = 'leased';
    state.jobAttempts = 2;
    state.leaseOwner = 'worker-1';
    state.leaseExpiresAt = new Date(Date.now() + 60_000);
    const secondWorker = createWorker(prisma, objects, pipeline, {}, 'worker-1');
    const second = (secondWorker as any).processJob(job({ attempts: 2 }));
    await secondPublishStarted.promise;

    firstPublish.resolve({
      bucket: 'public-media',
      key: publishedKeys[0],
      url: `https://media.test/${publishedKeys[0]}`,
    });
    await first;
    expect(state.sessionStatus).toBe('processing');
    expect(state.jobStatus).toBe('leased');
    expect(objects.deletePublished).not.toHaveBeenCalled();

    secondPublish.resolve({
      bucket: 'public-media',
      key: publishedKeys[1],
      url: `https://media.test/${publishedKeys[1]}`,
    });
    await second;

    expect(publishedKeys).toHaveLength(2);
    expect(publishedKeys[0]).not.toBe(publishedKeys[1]);
    expect(state.publishAttempts.get(
      [...state.publishAttempts.keys()].find((id) => publishedKeys[0].includes(id))!,
    )).toBe('cleanup_pending');
    expect(objects.deletePublished).not.toHaveBeenCalledWith('public-media', publishedKeys[1]);
    expect(state.sessionStatus).toBe('ready');
    expect(state.assetStatus).toBe('ready');
  });

  it('does not delete a stale staged key before a delayed publish can settle', async () => {
    const state = workerState();
    state.publishAttempts.set('attempt-1', 'staged');
    const prisma = workerPrisma(state);
    const createdAt = new Date(Date.now() - 60 * 60 * 1000);
    prisma.mediaPublishAttempt.findMany.mockResolvedValue([{
      id: 'attempt-1',
      sessionId: job().session.id,
      assetId: 'asset-1',
      jobId: 'job-1',
      workerId: 'worker-1',
      attempt: 1,
      publicBucket: 'public-media',
      publicKey: 'images/v2/late.webp',
      status: 'staged',
      createdAt,
      cleanedAt: null,
    }]);
    prisma.mediaProcessingJob.findUnique.mockResolvedValue({
      status: 'leased',
      attempts: 2,
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const objects = objectStore();
    const latePublish = deferred<void>();
    const materialized = latePublish.promise;
    const worker = createWorker(prisma, objects, { process: jest.fn() });

    await (worker as any).cleanupOrphanPublished(10);
    expect(objects.deletePublished).not.toHaveBeenCalled();
    expect(state.publishAttempts.get('attempt-1')).toBe('cleanup_pending');

    latePublish.resolve();
    await materialized;
    expect(objects.deletePublished).not.toHaveBeenCalled();
  });

  it('does not delete an attempt that became winner after cleanup selected it', async () => {
    const state = workerState();
    state.publishAttempts.set('attempt-winner', 'winner');
    const prisma = workerPrisma(state);
    prisma.mediaPublishAttempt.findMany.mockResolvedValue([{
      id: 'attempt-winner',
      sessionId: job().session.id,
      assetId: 'asset-1',
      jobId: 'job-1',
      workerId: 'worker-1',
      attempt: 1,
      publicBucket: 'public-media',
      publicKey: 'images/v2/winner.webp',
      status: 'published',
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      cleanedAt: null,
    }]);
    prisma.mediaProcessingJob.findUnique.mockResolvedValue({
      status: 'succeeded',
      attempts: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    const objects = objectStore();
    const worker = createWorker(prisma, objects, { process: jest.fn() });

    await (worker as any).cleanupOrphanPublished(10);
    expect(objects.deletePublished).not.toHaveBeenCalled();
    expect(state.publishAttempts.get('attempt-winner')).toBe('winner');
  });

  it('retains cleanup tracking when a timed-out publish can materialize late', async () => {
    const state = workerState();
    const prisma = workerPrisma(state);
    const publishStarted = deferred<void>();
    const publishResult = deferred<{ bucket: string; key: string; url: string }>();
    const objects = objectStore();
    objects.downloadQuarantineToFile.mockImplementation(async ({ destinationPath }) => {
      await writeFile(destinationPath, Buffer.alloc(10), { mode: 0o600 });
    });
    objects.publishFromFile.mockImplementation(() => {
      publishStarted.resolve();
      return publishResult.promise;
    });
    const worker = createWorker(prisma, objects, processingPipeline());

    const processing = (worker as any).processJob(job());
    await publishStarted.promise;
    publishResult.reject(new Error('publish timeout'));
    await processing;

    expect(objects.deletePublished).not.toHaveBeenCalled();
    expect([...state.publishAttempts.values()]).toContain('cleanup_pending');
    // A remote PUT materializing after the local timeout still has a durable
    // cleanup_pending row for the delayed two-pass maintenance sweeper.
    expect([...state.publishAttempts.values()]).not.toContain('cleaned');
  });

  it('does not delete a committed winner when finalization response is ambiguous', async () => {
    const state = workerState();
    const prisma = workerPrisma(state);
    const baseTransaction = prisma.$transaction.getMockImplementation()!;
    let injected = false;
    prisma.$transaction.mockImplementation(async (value: unknown) => {
      const result = await baseTransaction(value);
      if (!injected && state.sessionStatus === 'ready') {
        injected = true;
        throw new Error('database response lost after commit');
      }
      return result;
    });
    const objects = objectStore();
    objects.downloadQuarantineToFile.mockImplementation(async ({ destinationPath }) => {
      await writeFile(destinationPath, Buffer.alloc(10), { mode: 0o600 });
    });
    objects.publishFromFile.mockImplementation(async (input) => ({
      bucket: 'public-media',
      key: input.key,
      url: `https://media.test/${input.key}`,
    }));
    const worker = createWorker(prisma, objects, processingPipeline());

    await (worker as any).processJob(job());

    expect(state.sessionStatus).toBe('ready');
    expect([...state.publishAttempts.values()]).toContain('winner');
    expect(objects.deletePublished).not.toHaveBeenCalled();
  });

  it('backs off retryable failures and dead-letters the final failed attempt', async () => {
    const retryState = workerState();
    const retryPrisma = workerPrisma(retryState);
    const worker = createWorker(retryPrisma, objectStore(), { process: jest.fn() });
    await (worker as any).failJob(
      job({ attempts: 1, maxAttempts: 3 }),
      new MediaPipelineError('MALWARE_SCANNER_UNAVAILABLE', 'scanner down', true),
    );

    expect(retryState.jobStatus).toBe('retry_wait');
    expect(retryState.sessionStatus).toBe('queued');
    expect(retryState.assetStatus).toBe('quarantined');

    const deadState = workerState();
    deadState.jobAttempts = 3;
    const deadPrisma = workerPrisma(deadState);
    const deadWorker = createWorker(deadPrisma, objectStore(), { process: jest.fn() });
    await (deadWorker as any).failJob(
      job({ attempts: 3, maxAttempts: 3 }),
      new MediaPipelineError('MALWARE_SCANNER_UNAVAILABLE', 'scanner down', true),
    );

    expect(deadState.jobStatus).toBe('dead_letter');
    expect(deadState.sessionStatus).toBe('failed');
    expect(deadState.assetStatus).toBe('rejected');
  });

  it('removes only bounded, stale, owned worker temp artifacts', async () => {
    const staleWorker = join(base, 'worker-ABC123');
    const recentWorker = join(base, 'worker-recent');
    const staleOutput = join(base, `${'a'.repeat(48)}.webp`);
    const unrelated = join(base, 'do-not-delete.txt');
    mkdirSync(staleWorker);
    mkdirSync(recentWorker);
    writeFileSync(join(staleWorker, 'input'), 'stale');
    writeFileSync(staleOutput, 'stale');
    writeFileSync(unrelated, 'keep');
    symlinkSync(staleWorker, join(base, 'worker-symlink'));
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
    utimesSync(staleWorker, old, old);
    utimesSync(staleOutput, old, old);
    const worker = createWorker(
      workerPrisma(workerState()),
      objectStore(),
      { process: jest.fn() },
      {
        MEDIA_PROCESSING_STALE_TEMP_SECONDS: 6 * 60 * 60,
        MEDIA_PROCESSING_STALE_CLEANUP_LIMIT: 2,
      },
    );

    await (worker as any).cleanupStaleWorkerTemp();

    expect(readdirSync(base).sort()).toEqual([
      'do-not-delete.txt',
      'worker-recent',
      'worker-symlink',
    ]);
  });
});

function workerState() {
  return {
    sessionStatus: 'queued',
    jobStatus: 'leased',
    assetStatus: 'quarantined',
    leaseOwner: 'worker-1' as string | null,
    jobAttempts: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000) as Date | null,
    publishAttempts: new Map<string, string>(),
  };
}

function workerPrisma(state: ReturnType<typeof workerState>): any {
  const tx = {
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([{ status: state.sessionStatus }])),
    mediaProcessingJob: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({
        status: state.jobStatus,
        attempts: state.jobAttempts,
        leaseOwner: state.leaseOwner,
        leaseExpiresAt: state.leaseExpiresAt,
      })),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        const matches = (
          state.jobStatus === where.status &&
          (!where.leaseOwner || state.leaseOwner === where.leaseOwner) &&
          (where.attempts == null || state.jobAttempts === where.attempts) &&
          (!where.leaseExpiresAt?.gt ||
            (state.leaseExpiresAt?.getTime() ?? 0) > where.leaseExpiresAt.gt.getTime())
        );
        if (matches && data.status) state.jobStatus = data.status;
        if (matches && Object.prototype.hasOwnProperty.call(data, 'leaseOwner')) {
          state.leaseOwner = data.leaseOwner;
        }
        if (matches && Object.prototype.hasOwnProperty.call(data, 'leaseExpiresAt')) {
          state.leaseExpiresAt = data.leaseExpiresAt;
        }
        return Promise.resolve({ count: matches ? 1 : 0 });
      }),
    },
    mediaUploadSession: {
      count: jest.fn().mockImplementation(() => Promise.resolve(state.sessionStatus === 'processing' ? 1 : 0)),
      updateMany: jest.fn().mockImplementation(({ data }: any) => {
        const mutable = ['queued', 'processing'].includes(state.sessionStatus);
        if (mutable && data.status) state.sessionStatus = data.status;
        return Promise.resolve({ count: mutable ? 1 : 0 });
      }),
    },
    mediaAsset: {
      update: jest.fn().mockImplementation(({ data }: any) => {
        if (data.status) state.assetStatus = data.status;
        return Promise.resolve({});
      }),
      updateMany: jest.fn().mockImplementation(({ data }: any) => {
        if (data.status) state.assetStatus = data.status;
        return Promise.resolve({ count: 1 });
      }),
    },
    mediaPublishAttempt: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        state.publishAttempts.set(data.id, data.status);
        return Promise.resolve({});
      }),
      updateMany: jest.fn().mockImplementation((input: any) => updatePublishAttempt(state, input)),
    },
  };
  return {
    $transaction: jest.fn().mockImplementation((value: unknown) => (
      Array.isArray(value)
        ? Promise.all(value)
        : (value as (client: typeof tx) => Promise<unknown>)(tx)
    )),
    mediaUploadSession: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ status: state.sessionStatus })),
      update: jest.fn().mockResolvedValue({}),
    },
    mediaProcessingJob: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({
        status: state.jobStatus,
        attempts: state.jobAttempts,
        leaseOwner: state.leaseOwner,
        leaseExpiresAt: state.leaseExpiresAt,
      })),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        const matches = (
          state.jobStatus === where.status &&
          (!where.leaseOwner || state.leaseOwner === where.leaseOwner) &&
          (where.attempts == null || state.jobAttempts === where.attempts) &&
          (!where.leaseExpiresAt?.gt ||
            (state.leaseExpiresAt?.getTime() ?? 0) > where.leaseExpiresAt.gt.getTime())
        );
        if (matches && data.status) state.jobStatus = data.status;
        if (matches && Object.prototype.hasOwnProperty.call(data, 'leaseOwner')) {
          state.leaseOwner = data.leaseOwner;
        }
        if (matches && Object.prototype.hasOwnProperty.call(data, 'leaseExpiresAt')) {
          state.leaseExpiresAt = data.leaseExpiresAt;
        }
        return Promise.resolve({ count: matches ? 1 : 0 });
      }),
    },
    mediaAsset: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaPublishAttempt: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
        state.publishAttempts.has(where.id)
          ? { status: state.publishAttempts.get(where.id) }
          : null,
      )),
      updateMany: jest.fn().mockImplementation((input: any) => updatePublishAttempt(state, input)),
    },
  };
}

function updatePublishAttempt(
  state: ReturnType<typeof workerState>,
  { where, data }: any,
) {
  const current = state.publishAttempts.get(where.id);
  const expected = where.status;
  const matches = current != null && (
    expected == null ||
    (typeof expected === 'string' && current === expected) ||
    (expected.in && expected.in.includes(current)) ||
    (expected.not && current !== expected.not)
  );
  if (matches && data.status) state.publishAttempts.set(where.id, data.status);
  return Promise.resolve({ count: matches ? 1 : 0 });
}

function objectStore(): jest.Mocked<UploadObjectStore> {
  return {
    quarantineBucket: jest.fn().mockReturnValue('quarantine'),
    publicBucket: jest.fn().mockReturnValue('public-media'),
    createMultipart: jest.fn(),
    presignPart: jest.fn(),
    listParts: jest.fn(),
    completeMultipart: jest.fn(),
    headQuarantine: jest.fn(),
    abortMultipart: jest.fn(),
    deleteQuarantine: jest.fn().mockResolvedValue(undefined),
    deletePublished: jest.fn().mockResolvedValue(undefined),
    downloadQuarantineToFile: jest.fn(),
    publishFromFile: jest.fn().mockResolvedValue({
      bucket: 'public-media',
      key: 'images/v2/asset-1.webp',
      url: 'https://media.test/object',
    }),
  };
}

function processingPipeline() {
  return {
    process: jest.fn(async ({ path }: { path: string }) => {
      const output = join(dirname(path), 'output.webp');
      await writeFile(output, 'safe', { mode: 0o600 });
      return {
        path: output,
        filename: 'safe.webp',
        mimeType: 'image/webp',
        size: 4,
        type: 'image',
        temporary: true,
        inputSha256: Buffer.alloc(32).toString('base64'),
        width: 1,
        height: 1,
      };
    }),
  };
}

function createWorker(
  prisma: any,
  objects: UploadObjectStore,
  pipeline: any,
  values: Record<string, number> = {},
  workerId = 'worker-1',
) {
  const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  const uploads = {
    cleanupExpired: jest.fn(),
    reconcileStaleCompletions: jest.fn(),
    cleanupCancelled: jest.fn(),
    cleanupTerminal: jest.fn(),
  };
  const worker = new MediaProcessingWorker(prisma, config, uploads as any, pipeline, objects);
  (worker as any).workerId = workerId;
  return worker;
}

function job(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'job-1',
    attempts: 1,
    maxAttempts: 3,
    leaseOwner: 'worker-1',
    session: {
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      collection: 'generic-image',
      declaredMimeType: 'image/png',
      declaredSize: 10,
      declaredSha256: null,
      quarantineBucket: 'persisted-quarantine',
      quarantineKey: 'quarantine/key',
      status: 'queued',
      asset: { id: 'asset-1' },
    },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
