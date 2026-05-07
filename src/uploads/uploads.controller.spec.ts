import { BadRequestException } from '@nestjs/common';
import { UploadsController, uploadLimits } from './uploads.controller';

describe('UploadsController', () => {
  const file = { originalname: 'upload.jpg', mimetype: 'image/jpeg', size: 100, buffer: Buffer.from('file') } as Express.Multer.File;
  let media: any;
  let controller: UploadsController;

  beforeEach(() => {
    media = {
      upload: jest.fn().mockResolvedValue({ url: '/api/uploads/test.webp' }),
    };
    controller = new UploadsController(media);
  });

  it.each([
    ['profilePhoto', 'profile-photo'],
    ['coverPhoto', 'cover-photo'],
    ['groupPhoto', 'group-photo'],
    ['chatPhoto', 'chat-photo'],
    ['actsnapMedia', 'actsnap-media'],
    ['postMedia', 'post-media'],
    ['commentMedia', 'comment-media'],
    ['image', 'generic-image'],
    ['video', 'generic-video'],
    ['mediaUpload', 'generic-media'],
  ] as const)('routes %s uploads to the %s media collection', async (method, collection) => {
    await controller[method](file);

    expect(media.upload).toHaveBeenCalledWith(file, collection);
  });

  it('routes batch uploads through the generic media collection', async () => {
    await expect(controller.mediaBatch([file, file])).resolves.toEqual({
      files: [{ url: '/api/uploads/test.webp' }, { url: '/api/uploads/test.webp' }],
    });

    expect(media.upload).toHaveBeenCalledTimes(2);
    expect(media.upload).toHaveBeenNthCalledWith(1, file, 'generic-media');
    expect(media.upload).toHaveBeenNthCalledWith(2, file, 'generic-media');
  });

  it('rejects empty batch uploads', async () => {
    await expect(controller.mediaBatch([])).rejects.toBeInstanceOf(BadRequestException);
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('rejects batch uploads over the total size limit', async () => {
    const oversizedFile = { ...file, size: 121 * 1024 * 1024 } as Express.Multer.File;

    await expect(controller.mediaBatch([oversizedFile])).rejects.toBeInstanceOf(BadRequestException);
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('keeps the batch per-file Multer limit within the total batch cap', () => {
    expect(uploadLimits.batchFileBytes * uploadLimits.batchFiles).toBeLessThanOrEqual(uploadLimits.batchBytes);
  });
});
