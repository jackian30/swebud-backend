import { Injectable } from '@nestjs/common';
import { MediaLibraryService } from './media-library/media-library.service';
import { MediaCollectionName, UploadResponse } from './media-library/types';

export type UploadCollection = MediaCollectionName;
export type { UploadResponse };

@Injectable()
export class MediaService {
  constructor(private readonly mediaLibrary: MediaLibraryService) {}

  kindForMime(mimeType: string) {
    return this.mediaLibrary.kindForMime(mimeType);
  }

  filterFor(allowed: 'image' | 'video' | 'audio' | 'media') {
    return this.mediaLibrary.filterFor(allowed);
  }

  upload(file: Express.Multer.File | undefined, collection: UploadCollection): Promise<UploadResponse> {
    return this.mediaLibrary.addMedia(file, collection);
  }
}
