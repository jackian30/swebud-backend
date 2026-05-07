import { Injectable } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
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
    await writeFile(join(uploadRoot, key), media.buffer);
    return { key, url: `/api/uploads/${key}`, path: `/uploads/${key}` };
  }
}
