import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class UploadV2ExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    if (body && typeof body === 'object' && 'code' in body && 'message' in body) {
      response.status(status).json(body);
      return;
    }
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      response.status(status).json({
        code: this.codeFor(status),
        message: 'Upload service is temporarily unavailable.',
        retryable: status === HttpStatus.SERVICE_UNAVAILABLE,
      });
      return;
    }
    const candidate = body && typeof body === 'object'
      ? body as { message?: string | string[] }
      : {};
    const message = Array.isArray(candidate.message)
      ? candidate.message.join('; ')
      : candidate.message ?? 'Upload request failed.';
    response.status(status).json({
      code: this.codeFor(status),
      message,
      retryable: status === HttpStatus.TOO_MANY_REQUESTS || status === HttpStatus.SERVICE_UNAVAILABLE,
    });
  }

  private codeFor(status: number) {
    if (status === HttpStatus.UNAUTHORIZED) return 'UPLOAD_AUTH_REQUIRED';
    if (status === HttpStatus.FORBIDDEN) return 'UPLOAD_ACCOUNT_NOT_VERIFIED';
    if (status === HttpStatus.NOT_FOUND) return 'UPLOAD_NOT_FOUND';
    if (status === HttpStatus.TOO_MANY_REQUESTS) return 'UPLOAD_RATE_LIMITED';
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'UPLOAD_SERVICE_UNAVAILABLE';
    if (status >= 500) return 'UPLOAD_INTERNAL_ERROR';
    return 'UPLOAD_REQUEST_INVALID';
  }
}
