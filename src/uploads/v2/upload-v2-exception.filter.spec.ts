import { HttpStatus } from '@nestjs/common';
import { UploadException } from './upload-errors';
import { UploadV2ExceptionFilter } from './upload-v2-exception.filter';

describe('UploadV2ExceptionFilter', () => {
  it('never reflects unknown server error details', () => {
    const { host, json } = responseHarness();
    const secret = 'postgresql://admin:super-secret@database.internal/swebudd';

    new UploadV2ExceptionFilter().catch(
      new Error(`Prisma failed while connecting to ${secret}`),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      code: 'UPLOAD_INTERNAL_ERROR',
      message: 'Upload service is temporarily unavailable.',
      retryable: false,
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain(secret);
  });

  it('preserves explicit structured upload errors', () => {
    const { host, status, json } = responseHarness();
    const error = new UploadException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'UPLOAD_STORAGE_UNAVAILABLE',
      'Upload storage is temporarily unavailable.',
      true,
    );

    new UploadV2ExceptionFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({
      code: 'UPLOAD_STORAGE_UNAVAILABLE',
      message: 'Upload storage is temporarily unavailable.',
      retryable: true,
    });
  });
});

function responseHarness() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
    }),
  } as any;
  return { host, status, json };
}
