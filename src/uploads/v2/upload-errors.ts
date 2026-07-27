import { HttpException, HttpStatus } from '@nestjs/common';

export type UploadErrorCode =
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_INVALID_STATE'
  | 'UPLOAD_EXPIRED'
  | 'UPLOAD_QUOTA_EXCEEDED'
  | 'UPLOAD_CONCURRENCY_EXCEEDED'
  | 'UPLOAD_INVALID_DECLARATION'
  | 'UPLOAD_INVALID_PARTS'
  | 'UPLOAD_INTEGRITY_FAILED'
  | 'UPLOAD_STORAGE_UNAVAILABLE';

export class UploadException extends HttpException {
  constructor(
    status: HttpStatus,
    code: UploadErrorCode,
    message: string,
    retryable = false,
  ) {
    super({ code, message, retryable }, status);
  }
}
