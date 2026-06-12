import { BadRequestException } from '@nestjs/common';
import { mediaCollections } from './collections';
import { MediaProcessor } from './media-processor.service';

describe('MediaProcessor', () => {
  let processor: MediaProcessor;

  beforeEach(() => {
    processor = new MediaProcessor();
  });

  it('rejects missing multipart files', async () => {
    await expect(processor.process(undefined, mediaCollections['generic-image'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsupported MIME types before storage', async () => {
    await expect(processor.process(file({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF') }), mediaCollections['generic-media'])).rejects.toThrow('Unsupported media type: application/pdf');
  });

  it('rejects media that the selected collection does not accept', async () => {
    await expect(processor.process(file({ mimetype: 'video/mp4', buffer: mp4Buffer() }), mediaCollections['generic-image'])).rejects.toThrow('Unsupported image upload type: video/mp4');
  });

  it('rejects files larger than the collection limit', async () => {
    const collection = { ...mediaCollections['generic-image'], maxBytes: 3 };

    await expect(processor.process(file({ mimetype: 'image/gif', buffer: gifBuffer(), size: 4 }), collection)).rejects.toThrow('Image is too large.');
  });

  it('rejects content whose magic bytes do not match the declared MIME type', async () => {
    await expect(processor.process(file({ mimetype: 'image/png', buffer: Buffer.from('not-a-png') }), mediaCollections['generic-image'])).rejects.toThrow('Uploaded file content does not match its media type.');
  });

  it('optimizes valid videos to MP4 when transcoding makes them smaller', async () => {
    jest.spyOn(processor as never, 'transcode').mockResolvedValue(Buffer.from('mp4') as never);

    const result = await processor.process(file({ mimetype: 'video/mp4', buffer: mp4Buffer(), size: mp4Buffer().length }), mediaCollections['generic-video']);

    expect(result).toMatchObject({
      buffer: Buffer.from('mp4'),
      mimeType: 'video/mp4',
      size: 3,
      type: 'video',
    });
    expect(result.filename).toMatch(/\.mp4$/);
  });

  it('keeps original video when transcoding is not smaller', async () => {
    const buffer = mp4Buffer();
    jest.spyOn(processor as never, 'transcode').mockResolvedValue(Buffer.concat([buffer, Buffer.from('larger')]) as never);

    const result = await processor.process(file({ mimetype: 'video/mp4', buffer, size: buffer.length }), mediaCollections['generic-video']);

    expect(result).toMatchObject({
      buffer,
      mimeType: 'video/mp4',
      size: buffer.length,
      type: 'video',
    });
    expect(result.filename).toMatch(/\.mp4$/);
  });

  it('optimizes valid audio to AAC m4a when transcoding makes it smaller', async () => {
    jest.spyOn(processor as never, 'transcode').mockResolvedValue(Buffer.from('aac') as never);

    const result = await processor.process(file({ mimetype: 'audio/mpeg', buffer: mp3Buffer(), size: mp3Buffer().length }), mediaCollections['generic-audio']);

    expect(result).toMatchObject({
      buffer: Buffer.from('aac'),
      mimeType: 'audio/mp4',
      size: 3,
      type: 'audio',
    });
    expect(result.filename).toMatch(/\.m4a$/);
  });

  it('keeps GIF images unconverted', async () => {
    const buffer = gifBuffer();

    const result = await processor.process(file({ mimetype: 'image/gif', buffer, size: buffer.length }), mediaCollections['generic-image']);

    expect(result).toMatchObject({
      buffer,
      mimeType: 'image/gif',
      size: buffer.length,
      type: 'image',
    });
    expect(result.filename).toMatch(/\.gif$/);
  });
});

function file(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  const buffer = overrides.buffer ?? Buffer.alloc(0);
  return {
    fieldname: 'file',
    originalname: 'upload.bin',
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: buffer.length,
    buffer,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

function gifBuffer() {
  return Buffer.from('GIF89a-image-data');
}

function mp4Buffer() {
  return Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00]);
}

function mp3Buffer() {
  return Buffer.from('ID3-audio-data');
}
