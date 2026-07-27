import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { S3UploadObjectStore } from './s3-upload-object-store';

describe('S3UploadObjectStore bounded I/O', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts a remote request at the validated general timeout', async () => {
    jest.useFakeTimers();
    const store = createStore({ MEDIA_S3_REQUEST_TIMEOUT_MS: 1_000 });
    const operation = jest.fn((signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    const pending = (store as any).withRequestTimeout(operation);
    const assertion = expect(pending).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(operation.mock.calls[0][0].aborted).toBe(true);
  });

  it('aborts and destroys a stalled GetObject response stream', async () => {
    jest.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'swebudd-s3-timeout-'));
    const destination = join(directory, 'download');
    const body = new PassThrough();
    const store = createStore({ MEDIA_S3_DOWNLOAD_TIMEOUT_MS: 10_000 });
    (store as any).client = {
      send: jest.fn().mockResolvedValue({ Body: body }),
    };

    const pending = store.downloadQuarantineToFile({
      bucket: 'persisted-quarantine',
      key: 'quarantine/key',
      destinationPath: destination,
    });
    const assertion = expect(pending).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(10_000);

    await assertion;
    expect(body.destroyed).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });

  it('uses portable multipart headers and leaves encryption to bucket policy', async () => {
    const store = createStore({});
    const send = jest.fn().mockResolvedValue({ UploadId: 'multipart-1' });
    (store as any).client = { send };

    await expect(store.createMultipart({
      bucket: 'private-quarantine',
      key: 'quarantine/v2/user/session/object',
      contentType: 'image/jpeg',
      metadata: { 'upload-session-id': 'session-1' },
    })).resolves.toEqual({ uploadId: 'multipart-1' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'private-quarantine',
      ChecksumAlgorithm: 'SHA256',
    });
    expect(send.mock.calls[0][0].input).not.toHaveProperty('ChecksumType');
    expect(send.mock.calls[0][0].input).not.toHaveProperty('ServerSideEncryption');
  });
});

function createStore(values: Record<string, string | number>) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'MEDIA_QUARANTINE_S3_BUCKET') return 'private-quarantine';
      if (key === 'MEDIA_S3_BUCKET') return 'public-media';
      if (key === 'MEDIA_PUBLIC_BASE_URL') return 'https://media.test/';
      return values[key];
    }),
  } as unknown as ConfigService;
  return new S3UploadObjectStore(config);
}
