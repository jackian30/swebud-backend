import { Module } from '@nestjs/common';
import { LocalStorageDriver } from './media-library/local-storage.driver';
import { MediaLibraryService } from './media-library/media-library.service';
import { MediaProcessor } from './media-library/media-processor.service';
import { MediaService } from './media.service';
import { UploadsController } from './uploads.controller';
import { AuthModule } from '../auth/auth.module';
import { LegacyProxyUploadGuard } from './legacy-proxy-upload.guard';
import { UploadProcessingGate } from './processing-gate';
import { UploadV2Controller } from './v2/upload-v2.controller';
import { UploadV2Service } from './v2/upload-v2.service';
import { S3UploadObjectStore } from './v2/s3-upload-object-store';
import { UPLOAD_OBJECT_STORE } from './v2/upload-object-store';
import { ClamAvMalwareScanner, MALWARE_SCANNER } from './v2/malware-scanner';
import { SecureMediaPipeline } from './v2/secure-media-pipeline';
import { MediaProcessingWorker } from './v2/media-processing.worker';
import { UploadV2ExceptionFilter } from './v2/upload-v2-exception.filter';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController, UploadV2Controller],
  providers: [
    LocalStorageDriver,
    MediaLibraryService,
    MediaProcessor,
    MediaService,
    UploadProcessingGate,
    LegacyProxyUploadGuard,
    UploadV2Service,
    S3UploadObjectStore,
    { provide: UPLOAD_OBJECT_STORE, useExisting: S3UploadObjectStore },
    ClamAvMalwareScanner,
    { provide: MALWARE_SCANNER, useExisting: ClamAvMalwareScanner },
    SecureMediaPipeline,
    MediaProcessingWorker,
    UploadV2ExceptionFilter,
  ],
  exports: [MediaService, MediaLibraryService, UploadV2Service],
})
export class UploadsModule {}
