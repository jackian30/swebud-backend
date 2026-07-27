import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaPipelineError } from './malware-scanner';
import { SecureMediaPipeline } from './secure-media-pipeline';

describe('SecureMediaPipeline', () => {
  let directory: string;
  let path: string;
  let processor: { process: jest.Mock };
  let scanner: { scan: jest.Mock };
  let pipeline: SecureMediaPipeline;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'swebudd-secure-pipeline-'));
    path = join(directory, 'input');
    writeFileSync(path, Buffer.from('safe-media-content'), { mode: 0o600 });
    processor = {
      process: jest.fn().mockResolvedValue({
        path: join(directory, 'output.webp'),
        filename: 'safe.webp',
        mimeType: 'image/webp',
        size: 10,
        type: 'image',
        temporary: true,
      }),
    };
    scanner = { scan: jest.fn().mockResolvedValue(undefined) };
    pipeline = new SecureMediaPipeline(processor as any, scanner);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('fails closed when the malware scanner is unavailable', async () => {
    scanner.scan.mockRejectedValue(new MediaPipelineError(
      'MALWARE_SCANNER_UNAVAILABLE',
      'scanner unavailable',
      true,
    ));

    await expect(run()).rejects.toMatchObject({
      code: 'MALWARE_SCANNER_UNAVAILABLE',
      retryable: true,
    });
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('rejects infected content without invoking a decoder', async () => {
    scanner.scan.mockRejectedValue(new MediaPipelineError(
      'MALWARE_DETECTED',
      'infected',
      false,
    ));

    await expect(run()).rejects.toMatchObject({
      code: 'MALWARE_DETECTED',
      retryable: false,
    });
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('rejects archive and image/archive polyglot signatures', async () => {
    writeFileSync(path, Buffer.concat([
      Buffer.from('safe-image-prefix'),
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      Buffer.from('zip-directory'),
    ]));

    await expect(run()).rejects.toMatchObject({
      code: 'ARCHIVE_OR_POLYGLOT_REJECTED',
      retryable: false,
    });
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('rejects a full-object checksum mismatch before media processing', async () => {
    await expect(run(Buffer.alloc(32, 9).toString('base64'))).rejects.toMatchObject({
      code: 'FULL_OBJECT_CHECKSUM_MISMATCH',
      retryable: false,
    });
    expect(processor.process).not.toHaveBeenCalled();
  });

  function run(declaredSha256?: string) {
    return pipeline.process({
      path,
      size: 18,
      mimeType: 'image/png',
      collection: 'generic-image',
      declaredSha256,
    });
  }
});
