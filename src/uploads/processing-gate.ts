import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type WaitingTask = () => void;

@Injectable()
export class UploadProcessingGate {
  private active = 0;
  private readonly waiting: WaitingTask[] = [];
  private readonly concurrency: number;
  private readonly maxQueue: number;

  constructor(config: ConfigService) {
    const configured = Number(config.get<string | number>('MEDIA_PROCESSING_CONCURRENCY') ?? 2);
    this.concurrency = Number.isInteger(configured) && configured >= 1 && configured <= 8 ? configured : 2;
    const configuredQueue = Number(config.get<string | number>('MEDIA_PROCESSING_MAX_QUEUE') ?? 16);
    this.maxQueue = Number.isInteger(configuredQueue) && configuredQueue >= 0 && configuredQueue <= 100
      ? configuredQueue
      : 16;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire() {
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueue) {
      throw new ServiceUnavailableException({
        code: 'UPLOAD_PROCESSING_BUSY',
        message: 'Upload processing is at capacity. Retry later.',
        retryable: true,
      });
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release() {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}
