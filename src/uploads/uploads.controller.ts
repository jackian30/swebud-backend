import { BadRequestException, Controller, Post, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { kindForMime } from './media-library/collections';
import { MediaService } from './media.service';
import { VerifiedAccountGuard } from '../auth/verified-account.guard';
import { legacyQuarantineStorage } from './legacy-quarantine.storage';
import { LegacyProxyUploadGuard } from './legacy-proxy-upload.guard';

const maxImageBytes = 15 * 1024 * 1024;
const maxVideoBytes = 100 * 1024 * 1024;
const maxAudioBytes = 25 * 1024 * 1024;
const maxBatchBytes = 120 * 1024 * 1024;
const maxBatchFiles = 6;
const maxBatchFileBytes = Math.floor(maxBatchBytes / maxBatchFiles);

export const uploadLimits = {
  imageBytes: maxImageBytes,
  videoBytes: maxVideoBytes,
  audioBytes: maxAudioBytes,
  batchBytes: maxBatchBytes,
  batchFiles: maxBatchFiles,
  batchFileBytes: maxBatchFileBytes,
} as const;

type AllowedUploadKind = 'image' | 'video' | 'audio' | 'media';

export function uploadFileFilter(allowed: AllowedUploadKind) {
  return (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
    const kind = kindForMime(file.mimetype);
    if (kind && (allowed === 'media' || kind === allowed)) return cb(null, true);
    cb(new BadRequestException(`Unsupported ${allowed} upload type: ${file.mimetype || 'unknown'}`), false);
  };
}

function singleUploadOptions(allowed: AllowedUploadKind, fileSize: number) {
  return {
    storage: legacyQuarantineStorage,
    fileFilter: uploadFileFilter(allowed),
    limits: {
      fileSize,
      files: 1,
      fields: 0,
      parts: 1,
      fieldNameSize: 64,
      headerPairs: 32,
    },
  };
}

const batchUploadOptions = {
  storage: legacyQuarantineStorage,
  fileFilter: uploadFileFilter('media'),
  limits: {
    fileSize: maxBatchFileBytes,
    files: maxBatchFiles,
    fields: 0,
    parts: maxBatchFiles,
    fieldNameSize: 64,
    headerPairs: 32,
  },
};

@UseGuards(JwtAuthGuard, VerifiedAccountGuard, LegacyProxyUploadGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly media: MediaService) {}

  @Post('profile-photo')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('image', maxImageBytes)))
  profilePhoto(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'profile-photo');
  }

  @Post('cover-photo')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('image', maxImageBytes)))
  coverPhoto(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'cover-photo');
  }

  @Post('group-photo')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('image', maxImageBytes)))
  groupPhoto(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'group-photo');
  }

  @Post('chat-photo')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('image', maxImageBytes)))
  chatPhoto(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'chat-photo');
  }

  @Post('actsnap-media')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('media', maxVideoBytes)))
  actsnapMedia(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'actsnap-media');
  }

  @Post('post-media')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('media', maxVideoBytes)))
  postMedia(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'post-media');
  }

  @Post('comment-media')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('image', maxImageBytes)))
  commentMedia(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'comment-media');
  }

  @Post('images')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('image', maxImageBytes)))
  image(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'generic-image');
  }

  @Post('videos')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('video', maxVideoBytes)))
  video(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'generic-video');
  }

  @Post('audio')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('audio', maxAudioBytes)))
  audio(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'generic-audio');
  }

  @Post('media')
  @UseInterceptors(FileInterceptor('file', singleUploadOptions('media', maxVideoBytes)))
  mediaUpload(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'generic-media');
  }

  @Post('media/batch')
  @UseInterceptors(FilesInterceptor('files', maxBatchFiles, batchUploadOptions))
  async mediaBatch(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Attach multipart files using the field name "files"');
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxBatchBytes) {
      await Promise.all(files.map((file) => file.path ? unlink(file.path).catch(() => undefined) : undefined));
      throw new BadRequestException('Batch upload is too large. Maximum total upload is 120MB.');
    }
    return { files: await Promise.all(files.map((file) => this.media.upload(file, 'generic-media'))) };
  }
}
