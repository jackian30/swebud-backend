import { BadRequestException } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { mediaCollections } from './collections';
import { MediaProcessor, processingTempDirectory } from './media-processor.service';

describe('MediaProcessor', () => {
  let processor: MediaProcessor;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'swebudd-processor-test-'));
    process.env.MEDIA_PROCESSING_TEMP_DIR = directory;
    processor = new MediaProcessor();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MEDIA_PROCESSING_TEMP_DIR;
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects missing multipart files', async () => {
    await expect(processor.process(undefined, mediaCollections['generic-image'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsupported MIME types before storage', async () => {
    await expect(processor.process(file(Buffer.from('%PDF'), 'application/pdf'), mediaCollections['generic-media']))
      .rejects.toThrow('Unsupported media type: application/pdf');
  });

  it('rejects media that the selected collection does not accept', async () => {
    await expect(processor.process(file(mp4Buffer(), 'video/mp4'), mediaCollections['generic-image']))
      .rejects.toThrow('Unsupported image upload type: video/mp4');
  });

  it('rejects files larger than the collection limit', async () => {
    const collection = { ...mediaCollections['generic-image'], maxBytes: 3 };

    await expect(processor.process(file(gifBuffer(), 'image/gif'), collection)).rejects.toThrow('Image is too large.');
  });

  it('rejects content whose magic bytes do not match the declared MIME type', async () => {
    await expect(processor.process(file(Buffer.from('not-a-png'), 'image/png'), mediaCollections['generic-image']))
      .rejects.toThrow('Uploaded file content does not match its media type.');
  });

  it('streams a valid image from disk into a safe WebP output path', async () => {
    const result = await processor.process(file(pngBuffer(), 'image/png'), mediaCollections['generic-image']);

    expect(result).toMatchObject({
      mimeType: 'image/webp',
      type: 'image',
      temporary: true,
      width: 1,
      height: 1,
    });
    expect(result).not.toHaveProperty('buffer');
    expect(result.filename).toMatch(/^[a-f0-9]{48}\.webp$/);
  });

  it('rejects video data, attachment, and excess audio streams', async () => {
    jest.spyOn(processor as never, 'probe').mockResolvedValue({
      format: { duration: '1' },
      streams: [
        { codec_type: 'video', width: 100, height: 100, avg_frame_rate: '30/1' },
        { codec_type: 'audio' },
        { codec_type: 'data' },
      ],
    } as never);

    await expect(processor.process(file(mp4Buffer(), 'video/mp4'), mediaCollections['generic-video']))
      .rejects.toThrow('no unsupported streams');
  });

  it('rejects an audio upload containing a video cover stream', async () => {
    jest.spyOn(processor as never, 'probe').mockResolvedValue({
      format: { duration: '1' },
      streams: [
        { codec_type: 'audio', sample_rate: '48000', channels: 2 },
        { codec_type: 'video', width: 100, height: 100 },
      ],
    } as never);

    await expect(processor.process(file(mp3Buffer(), 'audio/mpeg'), mediaCollections['generic-audio']))
      .rejects.toThrow('exactly one supported audio stream');
  });

  it('rejects missing video frame-rate and audio sample metadata', async () => {
    jest.spyOn(processor as any, 'probe').mockResolvedValueOnce({
      format: { duration: '1' },
      streams: [{ codec_type: 'video', width: 100, height: 100 }],
    });
    await expect(processor.process(file(mp4Buffer(), 'video/mp4'), mediaCollections['generic-video']))
      .rejects.toThrow('frame rate exceed safe limits');

    jest.restoreAllMocks();
    jest.spyOn(processor as any, 'probe').mockResolvedValueOnce({
      format: { duration: '1' },
      streams: [{ codec_type: 'audio', channels: 2 }],
    });
    await expect(processor.process(file(mp3Buffer(), 'audio/mpeg'), mediaCollections['generic-audio']))
      .rejects.toThrow('sample rate or channel count');
  });

  it('always transcodes video to a controlled MP4 rather than returning the original', async () => {
    jest.spyOn(processor as never, 'probe').mockResolvedValue({
      format: { duration: '1' },
      streams: [{ codec_type: 'video', width: 100, height: 100, avg_frame_rate: '30/1' }],
    } as never);
    jest.spyOn(processor as any, 'transcode').mockImplementation(async (...args: unknown[]) => {
      const output = args[1] as string;
      await writeFile(output, 'safe-mp4', { mode: 0o600 });
    });

    const result = await processor.process(file(mp4Buffer(), 'video/mp4'), mediaCollections['generic-video']);

    expect(result.path).not.toContain('input');
    expect(result).toMatchObject({ mimeType: 'video/mp4', type: 'video', temporary: true });
    expect(result).not.toHaveProperty('buffer');
  });

  it('deletes and rejects a transcoded output that exceeds the collection limit', async () => {
    jest.spyOn(processor as never, 'probe').mockResolvedValue({
      format: { duration: '1' },
      streams: [{ codec_type: 'video', width: 100, height: 100, avg_frame_rate: '30/1' }],
    } as never);
    let outputPath = '';
    jest.spyOn(processor as any, 'transcode').mockImplementation(async (...args: unknown[]) => {
      outputPath = args[1] as string;
      await writeFile(outputPath, Buffer.alloc(32), { mode: 0o600 });
    });
    const collection = { ...mediaCollections['generic-video'], maxBytes: mp4Buffer().length };

    await expect(processor.process(file(mp4Buffer(), 'video/mp4'), collection))
      .rejects.toThrow('Video output exceeds the collection size limit.');
    expect(() => writeFileSync(outputPath, 'recreated', { flag: 'wx' })).not.toThrow();
  });

  it('rejects a processing base directory which traverses a symlink', () => {
    const target = join(directory, 'target');
    const link = join(directory, 'link');
    mkdirSync(target);
    symlinkSync(target, link);
    process.env.MEDIA_PROCESSING_TEMP_DIR = link;

    expect(() => processingTempDirectory()).toThrow('may not traverse symlinks');
  });

  function file(bytes: Buffer, mimetype: string): Express.Multer.File {
    const path = join(directory, `input-${Math.random()}`);
    writeFileSync(path, bytes, { mode: 0o600 });
    return {
      fieldname: 'file',
      originalname: 'ignored-client-name.exe',
      encoding: '7bit',
      mimetype,
      size: bytes.length,
      buffer: undefined as never,
      stream: undefined as never,
      destination: directory,
      filename: 'input',
      path,
    };
  }
});

function gifBuffer() {
  return Buffer.from('GIF89a-image-data');
}

function mp4Buffer() {
  return Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00]);
}

function mp3Buffer() {
  return Buffer.from('ID3-audio-data');
}

function pngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}
