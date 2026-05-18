import { BadRequestException, Controller, Post, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { MediaService } from './media.service';

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

@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly media: MediaService) {}

  @Post('profile-photo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxImageBytes, files: 1 } }))
  profilePhoto(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'profile-photo');
  }

  @Post('cover-photo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxImageBytes, files: 1 } }))
  coverPhoto(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'cover-photo');
  }

  @Post('group-photo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxImageBytes, files: 1 } }))
  groupPhoto(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'group-photo');
  }

  @Post('chat-photo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxImageBytes, files: 1 } }))
  chatPhoto(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'chat-photo');
  }

  @Post('actsnap-media')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxVideoBytes, files: 1 } }))
  actsnapMedia(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'actsnap-media');
  }

  @Post('post-media')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxVideoBytes, files: 1 } }))
  postMedia(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'post-media');
  }

  @Post('comment-media')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxImageBytes, files: 1 } }))
  commentMedia(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'comment-media');
  }

  @Post('images')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxImageBytes, files: 1 } }))
  image(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'generic-image');
  }

  @Post('videos')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxVideoBytes, files: 1 } }))
  video(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'generic-video');
  }

  @Post('audio')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxAudioBytes, files: 1 } }))
  audio(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'generic-audio');
  }

  @Post('media')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxVideoBytes, files: 1 } }))
  mediaUpload(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file, 'generic-media');
  }

  @Post('media/batch')
  @UseInterceptors(FilesInterceptor('files', maxBatchFiles, { storage: memoryStorage(), limits: { fileSize: maxBatchFileBytes, files: maxBatchFiles } }))
  async mediaBatch(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Attach multipart files using the field name "files"');
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxBatchBytes) throw new BadRequestException('Batch upload is too large. Maximum total upload is 120MB.');
    return { files: await Promise.all(files.map((file) => this.media.upload(file, 'generic-media'))) };
  }
}
