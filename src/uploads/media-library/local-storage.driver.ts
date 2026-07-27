import { Injectable } from '@nestjs/common';
import { createReadStream, createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { mediaCollections } from './collections';
import { StorageDriver } from './storage-driver';
import { MediaCollection, ProcessedMedia } from './types';

const uploadRoot = join(process.cwd(), 'uploads');

@Injectable()
export class LocalStorageDriver implements StorageDriver {
  constructor() {
    for (const collection of Object.values(mediaCollections)) mkdirSync(join(uploadRoot, collection.folder), { recursive: true });
  }

  async put(collection: MediaCollection, media: ProcessedMedia) {
    const key = `${collection.folder}/${media.filename}`;
    await pipeline(
      createReadStream(media.path),
      createWriteStream(join(uploadRoot, key), { flags: 'wx', mode: 0o644 }),
    );
    return { key, url: `/api/uploads/${key}`, path: `/uploads/${key}` };
  }
}
