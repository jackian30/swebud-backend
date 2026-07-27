import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { open } from 'fs/promises';
import { collectionFor } from '../media-library/collections';
import { MediaProcessor } from '../media-library/media-processor.service';
import { MediaCollectionName, ProcessedMedia } from '../media-library/types';
import {
  MALWARE_SCANNER,
  MalwareScanner,
  MediaPipelineError,
} from './malware-scanner';

const ARCHIVE_PREFIXES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]),
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  Buffer.from([0x1f, 0x8b]),
  Buffer.from('%PDF-'),
  Buffer.from('MZ'),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
];

const ZIP_TRAILER_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x01, 0x02]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
];

@Injectable()
export class SecureMediaPipeline {
  constructor(
    private readonly processor: MediaProcessor,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  async process(input: {
    path: string;
    size: number;
    mimeType: string;
    collection: string;
    declaredSha256?: string | null;
  }): Promise<ProcessedMedia & { inputSha256: string }> {
    await this.scanner.scan(input.path);
    await this.assertNotArchiveOrPolyglot(input.path, input.mimeType);
    const inputSha256 = await this.sha256(input.path);
    if (input.declaredSha256 && inputSha256 !== input.declaredSha256) {
      throw new MediaPipelineError(
        'FULL_OBJECT_CHECKSUM_MISMATCH',
        'Full-object SHA-256 does not match the upload declaration.',
        false,
      );
    }
    try {
      const processed = await this.processor.process({
        fieldname: 'file',
        originalname: 'quarantined-media',
        encoding: '7bit',
        mimetype: input.mimeType,
        size: input.size,
        destination: '',
        filename: '',
        path: input.path,
        buffer: undefined as never,
        stream: undefined as never,
      }, collectionFor(input.collection as MediaCollectionName));
      return { ...processed, inputSha256 };
    } catch (error) {
      if (error instanceof MediaPipelineError) throw error;
      if (error instanceof BadRequestException) {
        throw new MediaPipelineError(
          'MEDIA_VALIDATION_FAILED',
          error.message || 'Media validation failed.',
          false,
        );
      }
      throw new MediaPipelineError(
        'MEDIA_PROCESSING_FAILED',
        'Media processing failed unexpectedly.',
        true,
      );
    }
  }

  private async sha256(path: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('base64');
  }

  private async assertNotArchiveOrPolyglot(path: string, mimeType: string) {
    const handle = await open(path, 'r');
    try {
      const prefix = Buffer.alloc(16);
      const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
      const bytes = prefix.subarray(0, prefixRead.bytesRead);
      if (ARCHIVE_PREFIXES.some((signature) => bytes.subarray(0, signature.length).equals(signature))) {
        throw new MediaPipelineError(
          'ARCHIVE_OR_POLYGLOT_REJECTED',
          'Archives, executables, documents, and media polyglots are not accepted.',
          false,
        );
      }
    } finally {
      await handle.close();
    }

    if (!mimeType.startsWith('image/')) return;
    let carry = Buffer.alloc(0);
    for await (const chunk of createReadStream(path)) {
      const bytes = Buffer.concat([carry, chunk as Buffer]);
      if (ZIP_TRAILER_SIGNATURES.some((signature) => bytes.indexOf(signature) >= 0)) {
        throw new MediaPipelineError(
          'ARCHIVE_OR_POLYGLOT_REJECTED',
          'Image contains an embedded archive and was rejected.',
          false,
        );
      }
      carry = bytes.subarray(Math.max(0, bytes.length - 3));
    }
  }
}
