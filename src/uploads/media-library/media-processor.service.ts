import { BadRequestException, Injectable } from '@nestjs/common';
import sharp = require('sharp');
import { assertCollectionAccepts, extensionForMime, kindForMime } from './collections';
import { MediaCollection, ProcessedMedia } from './types';

@Injectable()
export class MediaProcessor {
  async process(file: Express.Multer.File | undefined, collection: MediaCollection): Promise<ProcessedMedia> {
    if (!file) throw new BadRequestException('Attach a multipart file using the field name "file"');
    const kind = kindForMime(file.mimetype);
    if (!kind) throw new BadRequestException(`Unsupported media type: ${file.mimetype || 'unknown'}`);
    assertCollectionAccepts(collection, kind, file.mimetype);
    if (file.size > collection.maxBytes) throw new BadRequestException(`${kind === 'image' ? 'Image' : 'Video'} is too large.`);
    this.assertMagicBytes(file);

    if (kind === 'video') {
      return { buffer: file.buffer, filename: this.randomName(extensionForMime(file.mimetype)), mimeType: file.mimetype, size: file.buffer.length, type: 'video' };
    }
    return this.processImage(file, collection);
  }

  private async processImage(file: Express.Multer.File, collection: MediaCollection): Promise<ProcessedMedia> {
    if (file.mimetype === 'image/gif') {
      return { buffer: file.buffer, filename: this.randomName('.gif'), mimeType: 'image/gif', size: file.buffer.length, type: 'image' };
    }

    try {
      const image = sharp(file.buffer, { failOn: 'none' }).rotate();
      const metadata = await image.metadata();
      const pipeline = collection.conversion ? image.resize(collection.conversion) : image;
      const buffer = await pipeline.webp({ quality: 82, effort: 4 }).toBuffer();
      return {
        buffer,
        filename: this.randomName('.webp'),
        mimeType: 'image/webp',
        size: buffer.length,
        type: 'image',
        width: metadata.width,
        height: metadata.height,
      };
    } catch {
      throw new BadRequestException('Could not process that image. Try a JPG, PNG, WebP, or GIF file.');
    }
  }

  private randomName(extension: string) {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
  }

  private assertMagicBytes(file: Express.Multer.File) {
    const b = file.buffer;
    const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const isPng = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
    const isWebp = b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    const isGif = b.length > 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a');
    const isMp4Like = b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp';
    const isWebm = b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    const allowed =
      (file.mimetype === 'image/jpeg' && isJpeg) ||
      (file.mimetype === 'image/png' && isPng) ||
      (file.mimetype === 'image/webp' && isWebp) ||
      (file.mimetype === 'image/gif' && isGif) ||
      ((file.mimetype === 'video/mp4' || file.mimetype === 'video/quicktime') && isMp4Like) ||
      (file.mimetype === 'video/webm' && isWebm);
    if (!allowed) throw new BadRequestException('Uploaded file content does not match its media type.');
  }
}
