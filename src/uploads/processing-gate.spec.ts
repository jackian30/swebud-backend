import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadProcessingGate } from './processing-gate';

describe('UploadProcessingGate', () => {
  it('bounds the waiting queue and fails immediately once full', async () => {
    const config = {
      get: jest.fn((key: string) => key === 'MEDIA_PROCESSING_CONCURRENCY' ? 1 : key === 'MEDIA_PROCESSING_MAX_QUEUE' ? 1 : undefined),
    } as unknown as ConfigService;
    const gate = new UploadProcessingGate(config);
    let release!: () => void;
    const first = gate.run(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const second = gate.run(async () => undefined);

    await expect(gate.run(async () => undefined)).rejects.toBeInstanceOf(ServiceUnavailableException);
    release();
    await Promise.all([first, second]);
  });
});
