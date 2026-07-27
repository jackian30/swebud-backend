import { UploadV2Controller } from './upload-v2.controller';

describe('UploadV2Controller', () => {
  it('passes authenticated ownership through every session operation', async () => {
    const uploads = {
      create: jest.fn(),
      mintParts: jest.fn(),
      progress: jest.fn(),
      complete: jest.fn(),
      status: jest.fn(),
      cancel: jest.fn(),
    };
    const controller = new UploadV2Controller(uploads as any);
    const user = { id: 'user-1', emailVerified: true };
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const create = { collection: 'generic-image' as const, mimeType: 'image/png', size: 10 };
    const mint = { parts: [{ partNumber: 1, checksumSha256: Buffer.alloc(32).toString('base64') }] };
    const complete = { parts: [{ ...mint.parts[0], etag: '"etag"' }] };

    await controller.create(user, create);
    await controller.mintParts(user, sessionId, mint);
    await controller.progress(user, sessionId);
    await controller.complete(user, sessionId, complete);
    await controller.status(user, sessionId);
    await controller.cancel(user, sessionId);

    expect(uploads.create).toHaveBeenCalledWith('user-1', create);
    expect(uploads.mintParts).toHaveBeenCalledWith('user-1', sessionId, mint);
    expect(uploads.progress).toHaveBeenCalledWith('user-1', sessionId);
    expect(uploads.complete).toHaveBeenCalledWith('user-1', sessionId, complete);
    expect(uploads.status).toHaveBeenCalledWith('user-1', sessionId);
    expect(uploads.cancel).toHaveBeenCalledWith('user-1', sessionId);
  });
});
