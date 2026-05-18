import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { collectionFor, kindForMime } from './collections';
import { LocalStorageDriver } from './local-storage.driver';
import { MediaProcessor } from './media-processor.service';
import { S3StorageDriver } from './s3-storage.driver';
import { StorageDriver } from './storage-driver';
import { MediaCollectionName, UploadResponse } from './types';

@Injectable()
export class MediaLibraryService {
  private readonly driver: StorageDriver;

  constructor(
    private readonly config: ConfigService,
    private readonly processor: MediaProcessor,
    localStorage: LocalStorageDriver,
  ) {
    this.driver = this.storageDriverName() === 's3' ? new S3StorageDriver(this.config) : localStorage;
  }

  kindForMime(mimeType: string) {
    return kindForMime(mimeType);
  }

  filterFor(allowed: 'image' | 'video' | 'audio' | 'media') {
    return (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
      const kind = kindForMime(file.mimetype);
      if (kind && (allowed === 'media' || kind === allowed)) return cb(null, true);
      cb(new Error(`Unsupported ${allowed} upload type: ${file.mimetype || 'unknown'}`), false);
    };
  }

  async addMedia(file: Express.Multer.File | undefined, collectionName: MediaCollectionName): Promise<UploadResponse> {
    const collection = collectionFor(collectionName);
    const processed = await this.processor.process(file, collection);
    const stored = await this.driver.put(collection, processed);
    return {
      ...stored,
      collection: collection.name,
      filename: processed.filename,
      originalName: file?.originalname,
      mimeType: processed.mimeType,
      size: processed.size,
      type: processed.type,
      ...(processed.width ? { width: processed.width } : {}),
      ...(processed.height ? { height: processed.height } : {}),
    };
  }

  private storageDriverName() {
    return (this.config.get<string>('MEDIA_STORAGE_DRIVER') || 'local').toLowerCase();
  }
}
