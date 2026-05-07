import { Module } from '@nestjs/common';
import { LocalStorageDriver } from './media-library/local-storage.driver';
import { MediaLibraryService } from './media-library/media-library.service';
import { MediaProcessor } from './media-library/media-processor.service';
import { MediaService } from './media.service';
import { UploadsController } from './uploads.controller';

@Module({ controllers: [UploadsController], providers: [LocalStorageDriver, MediaLibraryService, MediaProcessor, MediaService], exports: [MediaService, MediaLibraryService] })
export class UploadsModule {}
