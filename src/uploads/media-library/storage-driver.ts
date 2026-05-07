import { MediaCollection, ProcessedMedia, StoredMedia } from './types';

export interface StorageDriver {
  put(collection: MediaCollection, media: ProcessedMedia): Promise<StoredMedia>;
}
