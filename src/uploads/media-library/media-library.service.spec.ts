import { ConfigService } from '@nestjs/config';
import { MediaLibraryService } from './media-library.service';
import { MediaProcessor } from './media-processor.service';
import { LocalStorageDriver } from './local-storage.driver';
import { MediaCollection, ProcessedMedia } from './types';

const putMock = jest.fn();

jest.mock('./s3-storage.driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    put: putMock,
  })),
}));

describe('MediaLibraryService', () => {
  const processed: ProcessedMedia = {
    buffer: Buffer.from('processed'),
    filename: 'processed.webp',
    mimeType: 'image/webp',
    size: 9,
    type: 'image',
    width: 20,
    height: 10,
  };

  const file = {
    originalname: 'source.png',
    mimetype: 'image/png',
  } as Express.Multer.File;

  let config: { get: jest.Mock };
  let processor: { process: jest.Mock };
  let localStorage: { put: jest.Mock };

  beforeEach(() => {
    putMock.mockReset();
    config = { get: jest.fn() };
    processor = { process: jest.fn().mockResolvedValue(processed) };
    localStorage = { put: jest.fn().mockResolvedValue({ key: 'images/processed.webp', url: '/api/uploads/images/processed.webp', path: '/uploads/images/processed.webp' }) };
  });

  it('uses the local storage driver by default', async () => {
    const service = new MediaLibraryService(config as unknown as ConfigService, processor as unknown as MediaProcessor, localStorage as unknown as LocalStorageDriver);

    const response = await service.addMedia(file, 'generic-image');

    expect(localStorage.put).toHaveBeenCalledWith(expect.objectContaining({ name: 'generic-image', folder: 'images' }), processed);
    expect(putMock).not.toHaveBeenCalled();
    expect(response).toEqual({
      key: 'images/processed.webp',
      url: '/api/uploads/images/processed.webp',
      path: '/uploads/images/processed.webp',
      collection: 'generic-image',
      filename: 'processed.webp',
      originalName: 'source.png',
      mimeType: 'image/webp',
      size: 9,
      type: 'image',
      width: 20,
      height: 10,
    });
  });

  it('uses the s3 storage driver when configured case-insensitively', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'MEDIA_STORAGE_DRIVER') return 'S3';
      if (key === 'MEDIA_S3_BUCKET') return 'media-bucket';
      return undefined;
    });
    putMock.mockResolvedValue({ key: 'images/processed.webp', url: 'https://cdn.example.test/images/processed.webp' });
    const { S3StorageDriver } = jest.requireMock('./s3-storage.driver');

    const service = new MediaLibraryService(config as unknown as ConfigService, processor as unknown as MediaProcessor, localStorage as unknown as LocalStorageDriver);

    await expect(service.addMedia(file, 'generic-image')).resolves.toMatchObject({
      key: 'images/processed.webp',
      url: 'https://cdn.example.test/images/processed.webp',
      collection: 'generic-image',
    });
    expect(S3StorageDriver).toHaveBeenCalledWith(config);
    expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'generic-image' }), processed);
    expect(localStorage.put).not.toHaveBeenCalled();
  });

  it.each([
    ['image' as const, 'image/png', true],
    ['image' as const, 'video/mp4', false],
    ['video' as const, 'video/webm', true],
    ['video' as const, 'image/jpeg', false],
    ['media' as const, 'video/quicktime', true],
    ['media' as const, 'application/pdf', false],
  ])('filters %s uploads with %s as accept=%s', (allowed, mimetype, accepted) => {
    const service = new MediaLibraryService(config as unknown as ConfigService, processor as unknown as MediaProcessor, localStorage as unknown as LocalStorageDriver);
    const cb = jest.fn();

    service.filterFor(allowed)(undefined, { mimetype } as Express.Multer.File, cb);

    if (accepted) {
      expect(cb).toHaveBeenCalledWith(null, true);
    } else {
      expect(cb).toHaveBeenCalledWith(expect.any(Error), false);
    }
  });

  it('passes the selected collection to the processor before storing', async () => {
    const service = new MediaLibraryService(config as unknown as ConfigService, processor as unknown as MediaProcessor, localStorage as unknown as LocalStorageDriver);

    await service.addMedia(file, 'profile-photo');

    expect(processor.process).toHaveBeenCalledWith(file, expect.objectContaining<Partial<MediaCollection>>({
      name: 'profile-photo',
      folder: 'profile-photos',
      accepts: 'image',
    }));
  });
});
