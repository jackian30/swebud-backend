import { BadRequestException, Controller, Post, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import sharp = require('sharp');
import { JwtAuthGuard } from '../auth/jwt.guard';

const uploadRoot = join(process.cwd(), 'uploads');
const imageDir = join(uploadRoot, 'images');
const videoDir = join(uploadRoot, 'videos');
mkdirSync(imageDir, { recursive: true });
mkdirSync(videoDir, { recursive: true });

const maxImageBytes = 15 * 1024 * 1024;
const maxVideoBytes = 100 * 1024 * 1024;
const maxBatchBytes = 120 * 1024 * 1024;

const allowedImageTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

const allowedVideoTypes = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
]);

type UploadKind = 'image' | 'video';
type UploadResponse = {
  url: string;
  path: string;
  filename: string;
  originalName?: string;
  mimeType: string;
  size: number;
  type: UploadKind;
  width?: number;
  height?: number;
};

const kindForMime = (mimeType: string): UploadKind | null => {
  if (allowedImageTypes.has(mimeType)) return 'image';
  if (allowedVideoTypes.has(mimeType)) return 'video';
  return null;
};

const extensionForMime = (mimeType: string): string => {
  const extension = allowedImageTypes.get(mimeType) ?? allowedVideoTypes.get(mimeType);
  if (!extension) throw new BadRequestException(`Unsupported media type: ${mimeType || 'unknown'}`);
  return extension;
};

const filterFor = (allowed: 'image' | 'video' | 'media') => (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
  const kind = kindForMime(file.mimetype);
  const allowedKind = allowed === 'media' || kind === allowed;
  if (kind && allowedKind) return cb(null, true);
  cb(new BadRequestException(`Unsupported ${allowed} upload type: ${file.mimetype || 'unknown'}`), false);
};

const randomName = (extension: string) => `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;

async function persistUpload(file?: Express.Multer.File): Promise<UploadResponse> {
  if (!file) throw new BadRequestException('Attach a multipart file using the field name "file"');
  const kind = kindForMime(file.mimetype);
  if (!kind) throw new BadRequestException(`Unsupported media type: ${file.mimetype || 'unknown'}`);
  assertMagicBytes(file);

  if (kind === 'image') return persistOptimizedImage(file);
  return persistVideo(file);
}

function assertMagicBytes(file: Express.Multer.File) {
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

async function persistOptimizedImage(file: Express.Multer.File): Promise<UploadResponse> {
  if (file.size > maxImageBytes) throw new BadRequestException('Image is too large. Maximum image upload is 15MB.');

  // Keep animated GIFs intact. Sharp can flatten animation unexpectedly; preserving is safer for MVP.
  if (file.mimetype === 'image/gif') {
    const filename = randomName('.gif');
    await writeFile(join(imageDir, filename), file.buffer);
    return mediaResponse({ kind: 'image', folder: 'images', filename, file, mimeType: 'image/gif', size: file.size });
  }

  try {
    const image = sharp(file.buffer, { failOn: 'none' }).rotate();
    const metadata = await image.metadata();
    const output = await image
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    const filename = randomName('.webp');
    await writeFile(join(imageDir, filename), output);
    return mediaResponse({
      kind: 'image',
      folder: 'images',
      filename,
      file,
      mimeType: 'image/webp',
      size: output.length,
      width: metadata.width,
      height: metadata.height,
    });
  } catch {
    throw new BadRequestException('Could not process that image. Try a JPG, PNG, WebP, or GIF file.');
  }
}

async function persistVideo(file: Express.Multer.File): Promise<UploadResponse> {
  if (file.size > maxVideoBytes) throw new BadRequestException('Video is too large. Maximum video upload is 100MB.');
  const filename = randomName(extensionForMime(file.mimetype));
  await writeFile(join(videoDir, filename), file.buffer);
  return mediaResponse({ kind: 'video', folder: 'videos', filename, file, mimeType: file.mimetype, size: file.size });
}

function mediaResponse(input: { kind: UploadKind; folder: 'images' | 'videos'; filename: string; file: Express.Multer.File; mimeType: string; size: number; width?: number; height?: number }): UploadResponse {
  const relative = `${input.folder}/${input.filename}`;
  return {
    url: `/api/uploads/${relative}`,
    path: `/uploads/${relative}`,
    filename: input.filename,
    originalName: input.file.originalname,
    mimeType: input.mimeType,
    size: input.size,
    type: input.kind,
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
  };
}

@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  @Post('images')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: filterFor('image'),
    limits: { fileSize: maxImageBytes, files: 1 },
  }))
  image(@UploadedFile() file: Express.Multer.File) {
    return persistUpload(file);
  }

  @Post('videos')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: filterFor('video'),
    limits: { fileSize: maxVideoBytes, files: 1 },
  }))
  video(@UploadedFile() file: Express.Multer.File) {
    return persistUpload(file);
  }

  @Post('media')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: filterFor('media'),
    limits: { fileSize: maxVideoBytes, files: 1 },
  }))
  media(@UploadedFile() file: Express.Multer.File) {
    return persistUpload(file);
  }

  @Post('media/batch')
  @UseInterceptors(FilesInterceptor('files', 6, {
    storage: memoryStorage(),
    fileFilter: filterFor('media'),
    limits: { fileSize: maxVideoBytes, files: 6 },
  }))
  async mediaBatch(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Attach multipart files using the field name "files"');
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxBatchBytes) throw new BadRequestException('Batch upload is too large. Maximum total upload is 120MB.');
    return { files: await Promise.all(files.map(persistUpload)) };
  }
}
