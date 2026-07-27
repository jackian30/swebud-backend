import { ConfigService } from '@nestjs/config';
import { MediaUploadSession } from '@prisma/client';
import { UploadObjectStore } from './upload-object-store';
import { UploadV2Service } from './upload-v2.service';

const checksum = Buffer.alloc(32, 7).toString('base64');

describe('UploadV2Service', () => {
  it('does not disclose a session owned by another account', async () => {
    const prisma = prismaMock();
    prisma.mediaUploadSession.findUnique.mockResolvedValue(session({ userId: 'other-user' }));
    const service = createService(prisma);

    await expect(service.status('user-1', session().id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UPLOAD_NOT_FOUND' }),
    });
  });

  it('does not expire a queued upload after its pre-completion URL TTL', async () => {
    const prisma = prismaMock();
    prisma.mediaUploadSession.findUnique.mockResolvedValue(session({
      status: 'queued',
      expiresAt: new Date(Date.now() - 60_000),
      parts: [],
      asset: null,
    }));
    const service = createService(prisma);

    await expect(service.status('user-1', session().id)).resolves.toMatchObject({ status: 'queued' });
    expect(prisma.mediaUploadSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not expire an in-flight completion when its signing TTL elapses', async () => {
    const prisma = prismaMock();
    prisma.mediaUploadSession.findUnique.mockResolvedValue(session({
      status: 'completing',
      completionClaimId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(),
      parts: [],
      asset: null,
    }));
    const objects = objectStoreMock();
    const service = createService(prisma, objects);

    await expect(service.status('user-1', session().id))
      .resolves.toMatchObject({ status: 'completing' });
    expect(prisma.mediaUploadSession.updateMany).not.toHaveBeenCalled();
    expect(objects.abortMultipart).not.toHaveBeenCalled();
    expect(objects.deleteQuarantine).not.toHaveBeenCalled();
  });

  it('keeps completing sessions out of expiry cleanup for fenced reconciliation', async () => {
    const prisma = prismaMock();
    const service = createService(prisma);

    await expect(service.cleanupExpired()).resolves.toBe(0);

    expect(prisma.mediaUploadSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: { in: ['creating', 'uploading'] },
            }),
          ]),
        }),
      }),
    );
  });

  it('serializes concurrent same-key creates and initializes S3 only once', async () => {
    const rows = new Map<string, MediaUploadSession>();
    let lock = Promise.resolve();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      mediaUploadSession: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(
          rows.get(`${where.userId_idempotencyKey.userId}:${where.userId_idempotencyKey.idempotencyKey}`) ?? null,
        )),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { declaredSize: null } }),
        create: jest.fn(({ data }: any) => {
          const created = session({ ...data, createdAt: new Date(), updatedAt: new Date() });
          rows.set(`${data.userId}:${data.idempotencyKey}`, created);
          return Promise.resolve(created);
        }),
      },
    };
    const prisma = prismaMock();
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => {
      const result = lock.then(() => callback(tx));
      lock = result.then(() => undefined, () => undefined);
      return result;
    });
    prisma.mediaUploadSession.findUnique.mockImplementation(({ where }: any) => Promise.resolve(
      [...rows.values()].find((row) => row.id === where.id) ?? null,
    ));
    prisma.mediaUploadSession.updateMany.mockImplementation(({ where, data }: any) => {
      const current = [...rows.values()].find((row) => row.id === where.id)!;
      if (!current || (where.status && current.status !== where.status)) return Promise.resolve({ count: 0 });
      Object.assign(current, data, { updatedAt: new Date() });
      return Promise.resolve({ count: 1 });
    });
    const createdInStorage = deferred<{ uploadId: string }>();
    const objects = objectStoreMock();
    objects.createMultipart.mockReturnValue(createdInStorage.promise);
    const service = createService(prisma, objects);
    const dto = {
      collection: 'generic-image' as const,
      mimeType: 'image/png',
      size: 100,
      sha256: checksum,
      idempotencyKey: 'same-key-123',
    };

    const first = service.create('user-1', dto);
    const second = service.create('user-1', dto);
    await expect(second).resolves.toMatchObject({ status: 'creating' });
    createdInStorage.resolve({ uploadId: 'multipart-1' });
    await expect(first).resolves.toMatchObject({ status: 'uploading' });
    expect(objects.createMultipart).toHaveBeenCalledTimes(1);
    expect(tx.mediaUploadSession.create).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a session cancelled while multipart creation is in flight', async () => {
    let current = session({ status: 'creating', providerUploadId: null, parts: [], asset: null });
    const createStarted = deferred<void>();
    const storageCreate = deferred<{ uploadId: string }>();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      mediaUploadSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { declaredSize: 0 } }),
        create: jest.fn(({ data }: any) => {
          current = session({ ...data, status: 'creating', parts: [], asset: null });
          return Promise.resolve(current);
        }),
      },
    };
    const prisma = prismaMock();
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    prisma.mediaUploadSession.findUnique.mockImplementation(() => Promise.resolve(current));
    prisma.mediaUploadSession.updateMany.mockImplementation(({ where, data }: any) => {
      const expected = where.status;
      const matches = typeof expected === 'string'
        ? current.status === expected
        : !expected?.in || expected.in.includes(current.status);
      if (!matches) return Promise.resolve({ count: 0 });
      current = { ...current, ...data, updatedAt: new Date() };
      return Promise.resolve({ count: 1 });
    });
    const objects = objectStoreMock();
    objects.createMultipart.mockImplementation(() => {
      createStarted.resolve();
      return storageCreate.promise;
    });
    objects.headQuarantine.mockResolvedValue(null);
    const service = createService(prisma, objects);

    const creating = service.create('user-1', {
      collection: 'generic-image',
      mimeType: 'image/png',
      size: 100,
      idempotencyKey: 'cancel-create-123',
    });
    await createStarted.promise;
    current = { ...current, status: 'cancelled', cancelledAt: new Date() };
    storageCreate.resolve({ uploadId: 'multipart-after-cancel' });

    await expect(creating).resolves.toMatchObject({ status: 'cancelled' });
    expect(objects.abortMultipart).toHaveBeenCalledWith({
      bucket: current.quarantineBucket,
      key: current.quarantineKey,
      uploadId: 'multipart-after-cancel',
    });
    expect(current).toMatchObject({
      status: 'cancelled',
      providerUploadId: 'multipart-after-cancel',
      quarantineCleanupStartedAt: expect.any(Date),
      quarantineDeletedAt: null,
    });
  });

  it('does not abort storage when only the post-claim response reload fails', async () => {
    let current = session({ status: 'creating', providerUploadId: null });
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      mediaUploadSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { declaredSize: 0 } }),
        create: jest.fn(({ data }: any) => {
          current = session({ ...data, status: 'creating' });
          return Promise.resolve(current);
        }),
      },
    };
    const prisma = prismaMock();
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    prisma.mediaUploadSession.updateMany.mockImplementation(({ where, data }: any) => {
      if (where.status !== current.status) return Promise.resolve({ count: 0 });
      current = { ...current, ...data };
      return Promise.resolve({ count: 1 });
    });
    prisma.mediaUploadSession.findUnique.mockRejectedValue(new Error('transient read failure'));
    const objects = objectStoreMock();
    objects.createMultipart.mockResolvedValue({ uploadId: 'multipart-1' });
    const service = createService(prisma, objects);

    await expect(service.create('user-1', {
      collection: 'generic-image',
      mimeType: 'image/png',
      size: 100,
    })).rejects.toThrow('transient read failure');
    expect(current).toMatchObject({ status: 'uploading', providerUploadId: 'multipart-1' });
    expect(objects.abortMultipart).not.toHaveBeenCalled();
  });

  it('enforces active upload concurrency before creating storage state', async () => {
    const prisma = prismaMock();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      mediaUploadSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(3),
      },
    };
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    const objects = objectStoreMock();
    const service = createService(prisma, objects);

    await expect(service.create('user-1', {
      collection: 'generic-image',
      mimeType: 'image/png',
      size: 100,
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UPLOAD_CONCURRENCY_EXCEEDED' }),
    });
    expect(objects.createMultipart).not.toHaveBeenCalled();
  });

  it('signs the exact non-final and final Content-Length for each upload part', async () => {
    const prisma = prismaMock();
    const partSize = 5 * 1024 * 1024;
    prisma.mediaUploadSession.findUnique.mockResolvedValue(session({
      status: 'uploading',
      providerUploadId: 'multipart-1',
      quarantineBucket: 'persisted-old-quarantine',
      partSize,
      declaredSize: partSize * 2 + 123,
      expectedPartCount: 3,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    }));
    const objects = objectStoreMock();
    objects.quarantineBucket.mockReturnValue('newly-configured-quarantine');
    objects.presignPart.mockImplementation(async ({ partNumber }) => `https://upload.test/${partNumber}`);
    const service = createService(prisma, objects);

    const result = await service.mintParts('user-1', session().id, {
      parts: [
        { partNumber: 2, checksumSha256: checksum },
        { partNumber: 3, checksumSha256: checksum },
      ],
    });

    expect(objects.presignPart).toHaveBeenNthCalledWith(1, expect.objectContaining({
      bucket: 'persisted-old-quarantine',
      partNumber: 2,
      contentLength: partSize,
    }));
    expect(objects.presignPart).toHaveBeenNthCalledWith(2, expect.objectContaining({
      bucket: 'persisted-old-quarantine',
      partNumber: 3,
      contentLength: 123,
    }));
    expect(result.parts.map((part) => part.requiredHeaders['content-length']))
      .toEqual([String(partSize), '123']);
  });

  it('rejects a completion whose authoritative part size does not match the declaration', async () => {
    const prisma = prismaMock();
    prisma.mediaUploadSession.findUnique.mockResolvedValue(session({
      status: 'uploading',
      providerUploadId: 'multipart-1',
      declaredSize: 5,
      expectedPartCount: 1,
    }));
    prisma.mediaUploadSession.updateMany.mockResolvedValue({ count: 1 });
    const objects = objectStoreMock();
    objects.listParts.mockResolvedValue([{
      partNumber: 1,
      etag: '"etag-1"',
      checksumSha256: checksum,
      size: 4,
    }]);
    const service = createService(prisma, objects);

    await expect(service.complete('user-1', session().id, {
      parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: checksum }],
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UPLOAD_INVALID_PARTS' }),
    });
    expect(objects.completeMultipart).not.toHaveBeenCalled();
  });

  it('deletes and rejects a completed object when HeadObject metadata or size mismatches', async () => {
    const prisma = prismaMock();
    prisma.mediaUploadSession.findUnique.mockResolvedValue(session({
      status: 'uploading',
      providerUploadId: 'multipart-1',
      declaredSize: 5,
      expectedPartCount: 1,
    }));
    prisma.mediaUploadSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.mediaUploadSession.update.mockResolvedValue(session({ status: 'rejected' }));
    prisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 });
    const tx = {
      $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([{
        status: 'completing',
        completionClaimId:
          prisma.mediaUploadSession.updateMany.mock.calls[0][0].data.completionClaimId,
      }])),
      mediaUploadPart: { upsert: jest.fn().mockResolvedValue({}) },
      mediaUploadSession: {
        update: jest.fn().mockResolvedValue(session({ status: 'rejected' })),
      },
      mediaAsset: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction.mockImplementation((value: unknown) => (
      Array.isArray(value)
        ? Promise.all(value)
        : (value as (client: typeof tx) => Promise<unknown>)(tx)
    ));
    const objects = objectStoreMock();
    objects.listParts.mockResolvedValue([{
      partNumber: 1,
      etag: '"etag-1"',
      checksumSha256: checksum,
      size: 5,
    }]);
    objects.completeMultipart.mockResolvedValue({ etag: '"object-etag"', checksumSha256: checksum });
    objects.headQuarantine.mockResolvedValue({
      size: 4,
      contentType: 'image/png',
      etag: '"object-etag"',
      checksumSha256: checksum,
      checksumType: 'COMPOSITE',
      metadata: {},
    });
    const service = createService(prisma, objects);

    await expect(service.complete('user-1', session().id, {
      parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: checksum }],
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UPLOAD_INTEGRITY_FAILED' }),
    });
    expect(objects.deleteQuarantine).toHaveBeenCalled();
    expect(tx.mediaUploadSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'rejected' }),
    }));
  });

  it('returns a queued completion idempotently without calling S3 again', async () => {
    const prisma = prismaMock();
    prisma.mediaUploadSession.findUnique.mockResolvedValue(session({
      status: 'queued',
      parts: [],
      asset: null,
    }));
    const objects = objectStoreMock();
    const service = createService(prisma, objects);

    await expect(service.complete('user-1', session().id, { parts: [] }))
      .resolves.toMatchObject({ status: 'queued' });
    expect(objects.completeMultipart).not.toHaveBeenCalled();
  });

  it('restores uploading after invalid parts so a corrected completion can succeed', async () => {
    const harness = completionHarness();
    harness.objects.listParts
      .mockResolvedValueOnce([storedPart(4)])
      .mockResolvedValueOnce([storedPart(5)]);
    harness.objects.completeMultipart.mockResolvedValue({
      etag: '"object-etag"',
      checksumSha256: checksum,
    });
    harness.objects.headQuarantine.mockResolvedValue(validHead(harness.current()));
    const dto = { parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: checksum }] };

    await expect(harness.service.complete('user-1', harness.current().id, dto))
      .rejects.toMatchObject({
        response: expect.objectContaining({ code: 'UPLOAD_INVALID_PARTS' }),
      });
    expect(harness.current()).toMatchObject({ status: 'uploading', completionClaimId: null });

    await expect(harness.service.complete('user-1', harness.current().id, dto))
      .resolves.toMatchObject({ status: 'queued' });
    expect(harness.objects.completeMultipart).toHaveBeenCalledTimes(1);
  });

  it('restores uploading after transient ListParts failure so retry can succeed', async () => {
    const harness = completionHarness();
    harness.objects.listParts
      .mockRejectedValueOnce(new Error('S3 timeout'))
      .mockResolvedValueOnce([storedPart(5)]);
    harness.objects.completeMultipart.mockResolvedValue({
      etag: '"object-etag"',
      checksumSha256: checksum,
    });
    harness.objects.headQuarantine.mockResolvedValue(validHead(harness.current()));
    const dto = { parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: checksum }] };

    await expect(harness.service.complete('user-1', harness.current().id, dto))
      .rejects.toMatchObject({
        response: expect.objectContaining({ code: 'UPLOAD_STORAGE_UNAVAILABLE' }),
      });
    expect(harness.current()).toMatchObject({ status: 'uploading', completionClaimId: null });

    await expect(harness.service.complete('user-1', harness.current().id, dto))
      .resolves.toMatchObject({ status: 'queued' });
  });

  it('recovers CompleteMultipart success after a transient HeadObject failure without completing twice', async () => {
    const harness = completionHarness();
    harness.objects.listParts.mockResolvedValue([storedPart(5)]);
    harness.objects.completeMultipart.mockResolvedValue({
      etag: '"object-etag"',
      checksumSha256: checksum,
    });
    harness.objects.headQuarantine
      .mockRejectedValueOnce(new Error('HEAD timeout'))
      .mockResolvedValueOnce(validHead(harness.current()));
    const dto = { parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: checksum }] };

    await expect(harness.service.complete('user-1', harness.current().id, dto))
      .rejects.toMatchObject({
        response: expect.objectContaining({ code: 'UPLOAD_STORAGE_UNAVAILABLE' }),
      });
    expect(harness.current()).toMatchObject({
      status: 'completing',
      failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS',
      completionClaimId: expect.any(String),
    });

    await expect(harness.service.complete('user-1', harness.current().id, dto))
      .resolves.toMatchObject({ status: 'queued' });
    expect(harness.objects.completeMultipart).toHaveBeenCalledTimes(1);
  });

  it('fences concurrent ambiguous recovery so an old reset cannot clobber a new claim', async () => {
    const oldClaim = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const harness = completionHarness(session({
      status: 'completing',
      completionClaimId: oldClaim,
      failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS',
      providerUploadId: 'multipart-1',
      declaredSize: 5,
      expectedPartCount: 1,
      parts: [storedDatabasePart(5)],
      asset: null,
    }));
    const firstList = deferred<any>();
    const secondList = deferred<any>();
    const listsStarted = deferred<void>();
    let listCalls = 0;
    harness.objects.headQuarantine
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(validHead(harness.current()));
    harness.objects.listParts.mockImplementation(() => {
      listCalls += 1;
      if (listCalls === 2) listsStarted.resolve();
      return listCalls === 1 ? firstList.promise : secondList.promise;
    });
    const completionStarted = deferred<void>();
    const storageCompletion = deferred<{ etag: string; checksumSha256: string }>();
    harness.objects.completeMultipart.mockImplementation(() => {
      completionStarted.resolve();
      return storageCompletion.promise;
    });
    const dto = { parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: checksum }] };

    const first = harness.service.complete('user-1', harness.current().id, dto);
    const second = harness.service.complete('user-1', harness.current().id, dto);
    await listsStarted.promise;
    firstList.resolve([storedPart(5)]);
    await completionStarted.promise;
    const newClaim = harness.current().completionClaimId;
    expect(newClaim).not.toBe(oldClaim);

    secondList.resolve([storedPart(5)]);
    await expect(second).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UPLOAD_INVALID_STATE' }),
    });
    expect(harness.current()).toMatchObject({
      status: 'completing',
      completionClaimId: newClaim,
    });

    storageCompletion.resolve({ etag: '"object-etag"', checksumSha256: checksum });
    await expect(first).resolves.toMatchObject({ status: 'queued' });
  });

  it('rejects an invalid recovered HeadObject even when no part rows were persisted', async () => {
    const claim = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const harness = completionHarness(session({
      status: 'completing',
      completionClaimId: claim,
      failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS',
      providerUploadId: 'multipart-1',
      parts: [],
      asset: null,
    }));
    harness.objects.headQuarantine.mockResolvedValue({
      ...validHead(harness.current()),
      size: harness.current().declaredSize + 1,
    });

    await expect(harness.service.status('user-1', harness.current().id))
      .resolves.toMatchObject({ status: 'rejected' });
    expect(harness.objects.deleteQuarantine).toHaveBeenCalled();
  });

  it('does not let a stale completion claim delete or reject an object owned by a newer claim', async () => {
    const oldClaim = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const newClaim = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const harness = completionHarness(session({
      status: 'completing',
      completionClaimId: oldClaim,
      failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS',
      providerUploadId: 'multipart-1',
      parts: [],
      asset: null,
    }));
    const headStarted = deferred<void>();
    const headResult = deferred<any>();
    harness.objects.headQuarantine.mockImplementation(() => {
      headStarted.resolve();
      return headResult.promise;
    });
    const completing = harness.service.complete('user-1', harness.current().id, {
      parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: checksum }],
    });
    await headStarted.promise;
    harness.replace({
      ...harness.current(),
      completionClaimId: newClaim,
      failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS',
      updatedAt: new Date(),
    });
    headResult.resolve({
      ...validHead(harness.current()),
      size: harness.current().declaredSize + 1,
    });

    await expect(completing).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UPLOAD_INVALID_STATE' }),
    });
    expect(harness.current()).toMatchObject({
      status: 'completing',
      completionClaimId: newClaim,
    });
    expect(harness.objects.deleteQuarantine).not.toHaveBeenCalled();
    expect(harness.tx.mediaAsset.updateMany).not.toHaveBeenCalled();
  });

  it('does not let stale status recovery delete or mutate a newer completion claim', async () => {
    const oldClaim = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const newClaim = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const harness = completionHarness(session({
      status: 'completing',
      completionClaimId: oldClaim,
      failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS',
      providerUploadId: 'multipart-1',
      parts: [],
      asset: null,
    }));
    const headStarted = deferred<void>();
    const headResult = deferred<any>();
    harness.objects.headQuarantine.mockImplementation(() => {
      headStarted.resolve();
      return headResult.promise;
    });
    const recovering = harness.service.status('user-1', harness.current().id);
    await headStarted.promise;
    harness.replace({
      ...harness.current(),
      completionClaimId: newClaim,
      failureCode: 'UPLOAD_COMPLETION_AMBIGUOUS',
      updatedAt: new Date(),
    });
    headResult.resolve({
      ...validHead(harness.current()),
      size: harness.current().declaredSize + 1,
    });

    await expect(recovering).resolves.toMatchObject({
      status: 'completing',
    });
    expect(harness.current()).toMatchObject({ completionClaimId: newClaim });
    expect(harness.objects.deleteQuarantine).not.toHaveBeenCalled();
    expect(harness.tx.mediaAsset.updateMany).not.toHaveBeenCalled();
  });

  it('does not queue or resurrect a session cancelled while S3 completion is in flight', async () => {
    let current = session({
      status: 'uploading',
      providerUploadId: 'multipart-1',
      declaredSize: 5,
      expectedPartCount: 1,
      parts: [],
      asset: null,
    });
    const completionStarted = deferred<void>();
    const storageCompletion = deferred<{ etag: string; checksumSha256: string }>();
    const tx = {
      $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([{
        status: current.status,
        completionClaimId: current.completionClaimId,
      }])),
      mediaUploadSession: {
        updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
          const disallowed = where.status?.notIn as string[] | undefined;
          if (disallowed?.includes(current.status)) return Promise.resolve({ count: 0 });
          current = { ...current, ...data, updatedAt: new Date() };
          return Promise.resolve({ count: 1 });
        }),
        update: jest.fn(),
      },
      mediaProcessingJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn(),
      },
      mediaAsset: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn(),
      },
      mediaUploadPart: { upsert: jest.fn() },
    };
    const prisma = prismaMock();
    prisma.mediaUploadSession.findUnique.mockImplementation(() => Promise.resolve(current));
    prisma.mediaUploadSession.updateMany.mockImplementation(({ where, data }: any) => {
      if (typeof where.status === 'string' && current.status !== where.status) {
        return Promise.resolve({ count: 0 });
      }
      current = { ...current, ...data, updatedAt: new Date() };
      return Promise.resolve({ count: 1 });
    });
    prisma.$transaction.mockImplementation((value: unknown) => (
      Array.isArray(value)
        ? Promise.all(value)
        : (value as (client: typeof tx) => Promise<unknown>)(tx)
    ));
    const objects = objectStoreMock();
    objects.listParts.mockResolvedValue([{
      partNumber: 1,
      etag: '"etag-1"',
      checksumSha256: checksum,
      size: 5,
    }]);
    objects.completeMultipart.mockImplementation(() => {
      completionStarted.resolve();
      return storageCompletion.promise;
    });
    // Cancellation removes the object before complete() reaches its
    // authoritative post-completion HeadObject check.
    objects.headQuarantine.mockResolvedValue(null);
    const service = createService(prisma, objects);

    const completing = service.complete('user-1', current.id, {
      parts: [{ partNumber: 1, etag: '"etag-1"', checksumSha256: checksum }],
    });
    await completionStarted.promise;
    await expect(service.cancel('user-1', current.id)).resolves.toMatchObject({ status: 'cancelled' });
    storageCompletion.resolve({ etag: '"object-etag"', checksumSha256: checksum });

    await expect(completing).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UPLOAD_INVALID_STATE' }),
    });
    expect(current.status).toBe('cancelled');
    expect(tx.mediaUploadPart.upsert).toHaveBeenCalled();
    expect(tx.mediaAsset.upsert).not.toHaveBeenCalled();
    expect(tx.mediaProcessingJob.upsert).not.toHaveBeenCalled();
    expect(current.quarantineCleanupStartedAt).toEqual(expect.any(Date));
    expect(current.quarantineDeletedAt).toBeNull();
  });

  it('claims cancellation in the DB before starting storage cleanup and keeps deletion pending on abort failure', async () => {
    const prisma = prismaMock();
    let dbCancelled = false;
    const current = session({
      status: 'uploading',
      providerUploadId: 'multipart-1',
      parts: [],
      asset: null,
    });
    prisma.mediaUploadSession.findUnique.mockImplementation(() => Promise.resolve(
      dbCancelled ? { ...current, status: 'cancelled' } : current,
    ));
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback({
      mediaUploadSession: {
        updateMany: jest.fn().mockImplementation(() => {
          dbCancelled = true;
          return Promise.resolve({ count: 1 });
        }),
      },
      mediaProcessingJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      mediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    }));
    const objects = objectStoreMock();
    objects.abortMultipart.mockImplementation(async () => {
      expect(dbCancelled).toBe(true);
      throw new Error('network unavailable');
    });
    objects.headQuarantine.mockRejectedValue(new Error('network unavailable'));
    const service = createService(prisma, objects);

    await expect(service.cancel('user-1', current.id)).resolves.toMatchObject({ status: 'cancelled' });
    expect(prisma.mediaUploadSession.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quarantineDeletedAt: expect.anything() }),
    }));
  });

  it('keeps multipart cleanup pending when abort fails even if HeadObject is absent', async () => {
    const prisma = prismaMock();
    const current = session({
      status: 'cancelled',
      providerUploadId: 'multipart-1',
      quarantineCleanupStartedAt: new Date(Date.now() - 31 * 60_000),
      parts: [],
      asset: null,
    });
    prisma.mediaUploadSession.findMany.mockResolvedValue([current]);
    prisma.mediaUploadSession.updateMany.mockResolvedValue({ count: 1 });
    const objects = objectStoreMock();
    objects.abortMultipart.mockRejectedValue(new Error('multipart already gone'));
    objects.headQuarantine.mockResolvedValue(null);
    const service = createService(prisma, objects);

    await expect(service.cleanupCancelled()).resolves.toBe(0);
    expect(prisma.mediaUploadSession.updateMany).not.toHaveBeenCalled();
  });

  it('treats classified NoSuchUpload plus absent HeadObject as successful cleanup', async () => {
    const prisma = prismaMock();
    const current = session({
      status: 'cancelled',
      providerUploadId: 'multipart-1',
      quarantineCleanupStartedAt: new Date(Date.now() - 31 * 60_000),
      parts: [],
      asset: null,
    });
    prisma.mediaUploadSession.findMany.mockResolvedValue([current]);
    prisma.mediaUploadSession.updateMany.mockResolvedValue({ count: 1 });
    const objects = objectStoreMock();
    objects.abortMultipart.mockResolvedValue({ outcome: 'not_found' });
    objects.headQuarantine.mockResolvedValue(null);
    const service = createService(prisma, objects);

    await expect(service.cleanupCancelled()).resolves.toBe(1);
    expect(prisma.mediaUploadSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['cancelled'] } }),
      data: { quarantineDeletedAt: expect.any(Date) },
    }));
  });

  it('keeps a quarantine tombstone and deletes an object that materializes after the first abort/head pass', async () => {
    let current = session({
      status: 'cancelled',
      providerUploadId: 'multipart-1',
      quarantineCleanupStartedAt: null,
      quarantineDeletedAt: null,
      parts: [],
      asset: null,
    });
    const prisma = prismaMock();
    prisma.mediaUploadSession.findMany.mockImplementation(() => Promise.resolve([current]));
    prisma.mediaUploadSession.updateMany.mockImplementation(({ data }: any) => {
      current = { ...current, ...data };
      return Promise.resolve({ count: 1 });
    });
    const objects = objectStoreMock();
    objects.abortMultipart.mockResolvedValue({ outcome: 'not_found' });
    objects.headQuarantine
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(validHead(current));
    const service = createService(prisma, objects);

    await expect(service.cleanupCancelled()).resolves.toBe(0);
    expect(current).toMatchObject({
      quarantineCleanupStartedAt: expect.any(Date),
      quarantineDeletedAt: null,
    });
    expect(objects.deleteQuarantine).not.toHaveBeenCalled();

    current = {
      ...current,
      quarantineCleanupStartedAt: new Date(Date.now() - 31 * 60_000),
    };
    await expect(service.cleanupCancelled()).resolves.toBe(1);
    expect(objects.deleteQuarantine).toHaveBeenCalledWith({
      bucket: current.quarantineBucket,
      key: current.quarantineKey,
    });
    expect(current.quarantineDeletedAt).toBeInstanceOf(Date);
  });

  it('retries quarantine cleanup for terminal worker failures', async () => {
    const prisma = prismaMock();
    const failed = session({
      status: 'failed',
      providerUploadId: 'multipart-1',
      quarantineCleanupStartedAt: new Date(Date.now() - 31 * 60_000),
      quarantineDeletedAt: null,
    });
    prisma.mediaUploadSession.findMany.mockResolvedValue([failed]);
    prisma.mediaUploadSession.updateMany.mockResolvedValue({ count: 1 });
    const objects = objectStoreMock();
    objects.abortMultipart.mockResolvedValue({ outcome: 'not_found' });
    objects.headQuarantine.mockResolvedValue(null);
    const service = createService(prisma, objects);

    await expect(service.cleanupTerminal()).resolves.toBe(1);
    expect(prisma.mediaUploadSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['failed', 'rejected'] } }),
      take: 100,
    }));
  });
});

function completionHarness(initial = session({
  status: 'uploading',
  providerUploadId: 'multipart-1',
  declaredSize: 5,
  expectedPartCount: 1,
  parts: [],
  asset: null,
})) {
  let current = initial;
  const prisma = prismaMock();
  const matchesStatus = (where: any) => {
    if (typeof where.status === 'string' && current.status !== where.status) return false;
    if (where.status?.in && !where.status.in.includes(current.status)) return false;
    if (where.status?.notIn && where.status.notIn.includes(current.status)) return false;
    if (
      Object.prototype.hasOwnProperty.call(where, 'completionClaimId') &&
      where.completionClaimId !== current.completionClaimId
    ) return false;
    return true;
  };
  const updateCurrent = ({ where, data }: any) => {
    if (!matchesStatus(where)) return Promise.resolve({ count: 0 });
    current = { ...current, ...data, updatedAt: new Date() };
    return Promise.resolve({ count: 1 });
  };
  const upsertPart = ({ create, update }: any) => {
    const value = create ?? update;
    const part = {
      partNumber: value.partNumber ?? 1,
      etag: value.etag,
      checksumSha256: value.checksumSha256,
      byteSize: value.byteSize,
    };
    const remaining = (current.parts ?? []).filter(
      (candidate: any) => candidate.partNumber !== part.partNumber,
    );
    current = { ...current, parts: [...remaining, part] };
    return Promise.resolve(part);
  };
  const tx = {
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([{
      status: current.status,
      completionClaimId: current.completionClaimId,
    }])),
    mediaUploadPart: { upsert: jest.fn().mockImplementation(upsertPart) },
    mediaAsset: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    mediaProcessingJob: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    mediaUploadSession: {
      updateMany: jest.fn().mockImplementation(updateCurrent),
      update: jest.fn().mockImplementation(({ data }: any) => {
        current = { ...current, ...data, updatedAt: new Date() };
        return Promise.resolve(current);
      }),
    },
  };
  prisma.mediaUploadSession.findUnique.mockImplementation(() => Promise.resolve(current));
  prisma.mediaUploadSession.updateMany.mockImplementation(updateCurrent);
  prisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 });
  prisma.$transaction.mockImplementation((value: unknown) => (
    Array.isArray(value)
      ? Promise.all(value)
      : (value as (client: typeof tx) => Promise<unknown>)(tx)
  ));
  const objects = objectStoreMock();
  const service = createService(prisma, objects);
  return {
    service,
    prisma,
    objects,
    tx,
    current: () => current,
    replace: (replacement: typeof current) => {
      current = replacement;
    },
  };
}

function storedPart(size: number) {
  return {
    partNumber: 1,
    etag: '"etag-1"',
    checksumSha256: checksum,
    size,
  };
}

function storedDatabasePart(size: number) {
  return {
    partNumber: 1,
    etag: '"etag-1"',
    checksumSha256: checksum,
    byteSize: size,
  };
}

function validHead(value: ReturnType<typeof session>) {
  return {
    size: value.declaredSize,
    contentType: value.declaredMimeType,
    etag: '"object-etag"',
    checksumSha256: checksum,
    checksumType: 'COMPOSITE',
    metadata: {
      'upload-session-id': value.id,
      'owner-id': value.userId,
      'declared-size': String(value.declaredSize),
      collection: value.collection,
    },
  };
}

function session(overrides: Record<string, unknown> = {}): any {
  const now = new Date();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    idempotencyKey: null,
    collection: 'generic-image',
    declaredMimeType: 'image/png',
    declaredSize: 100,
    declaredSha256: null,
    quarantineBucket: 'private-quarantine',
    quarantineKey: 'quarantine/key',
    providerUploadId: null,
    checksumAlgorithm: 'SHA256',
    partSize: 8 * 1024 * 1024,
    expectedPartCount: 1,
    status: 'uploading',
    completionClaimId: null,
    objectEtag: null,
    objectChecksumSha256: null,
    failureCode: null,
    failureMessage: null,
    expiresAt: new Date(now.getTime() + 60_000),
    completedAt: null,
    cancelledAt: null,
    quarantineCleanupStartedAt: null,
    quarantineDeletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function prismaMock(): any {
  return {
    mediaUploadSession: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
    },
    mediaUploadPart: { upsert: jest.fn() },
    mediaAsset: {
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    mediaProcessingJob: {
      upsert: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  };
}

function objectStoreMock(): jest.Mocked<UploadObjectStore> {
  return {
    quarantineBucket: jest.fn().mockReturnValue('private-quarantine'),
    publicBucket: jest.fn().mockReturnValue('public-media'),
    createMultipart: jest.fn(),
    presignPart: jest.fn(),
    listParts: jest.fn(),
    completeMultipart: jest.fn(),
    headQuarantine: jest.fn(),
    abortMultipart: jest.fn().mockResolvedValue({ outcome: 'aborted' }),
    deleteQuarantine: jest.fn().mockResolvedValue(undefined),
    deletePublished: jest.fn().mockResolvedValue(undefined),
    downloadQuarantineToFile: jest.fn(),
    publishFromFile: jest.fn(),
  };
}

function createService(
  prisma = prismaMock(),
  objects = objectStoreMock(),
  values: Record<string, string | number> = {},
) {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new UploadV2Service(prisma, config, objects);
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
