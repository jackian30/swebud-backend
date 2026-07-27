import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'fs';
import { chmod, open, stat, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import sharp = require('sharp');
import type { SharpConstructor } from 'sharp';
import { assertCollectionAccepts, kindForMime } from './collections';
import { MediaCollection, ProcessedMedia } from './types';

const createSharp = sharp as unknown as SharpConstructor;
// libvips otherwise sizes its pool from host CPU count, which can allow a
// small request concurrency to fan out into an unbounded number of threads.
sharp.concurrency(2);
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_FRAMES = 120;
const MAX_MEDIA_DURATION_SECONDS = 10 * 60;
const MAX_VIDEO_WIDTH = 3_840;
const MAX_VIDEO_HEIGHT = 2_160;
const MAX_VIDEO_FRAME_RATE = 120;
const MAX_VIDEO_FRAMES = 72_000;
const PROCESS_TIMEOUT_MS = 3 * 60 * 1_000;
const MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
};

type ProbeOutput = {
  format?: { duration?: string; format_name?: string };
  streams?: ProbeStream[];
};

export function processingTempDirectory() {
  const configured = process.env.MEDIA_PROCESSING_TEMP_DIR?.trim();
  const directory = configured
    ? (isAbsolute(configured) ? configured : resolve(process.cwd(), configured))
    : join(tmpdir(), 'swebudd-media-processing');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== resolve(directory)) {
    throw new Error('MEDIA_PROCESSING_TEMP_DIR must be a real directory and may not traverse symlinks.');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('MEDIA_PROCESSING_TEMP_DIR must be owned by the application user.');
  }
  chmodSync(directory, 0o700);
  return directory;
}

@Injectable()
export class MediaProcessor {
  async process(file: Express.Multer.File | undefined, collection: MediaCollection): Promise<ProcessedMedia> {
    if (!file?.path) throw new BadRequestException('Attach a multipart file using the field name "file"');
    const kind = kindForMime(file.mimetype);
    if (!kind) throw new BadRequestException(`Unsupported media type: ${file.mimetype || 'unknown'}`);
    assertCollectionAccepts(collection, kind, file.mimetype);
    const inputStat = await stat(file.path).catch(() => null);
    if (!inputStat?.isFile()) throw new BadRequestException('Uploaded file is unavailable.');
    if (inputStat.size !== file.size) throw new BadRequestException('Uploaded file size changed during processing.');
    if (inputStat.size > collection.maxBytes) {
      throw new BadRequestException(`${kind === 'image' ? 'Image' : kind === 'audio' ? 'Audio' : 'Video'} is too large.`);
    }
    await this.assertMagicBytes(file.path, file.mimetype);

    if (kind === 'video') return this.processVideo(file, collection.maxBytes);
    if (kind === 'audio') return this.processAudio(file, collection.maxBytes);
    return this.processImage(file, collection);
  }

  private async processImage(file: Express.Multer.File, collection: MediaCollection): Promise<ProcessedMedia> {
    const outputPath = this.randomPath('.webp');
    try {
      const image = createSharp(file.path, {
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
        pages: 1,
      }).rotate();
      const metadata = await image.metadata();
      const width = metadata.width ?? 0;
      const height = metadata.pageHeight ?? metadata.height ?? 0;
      const frames = metadata.pages ?? 1;
      if (!width || !height || width * height > MAX_IMAGE_PIXELS || frames > MAX_IMAGE_FRAMES) {
        throw new Error('unsafe image dimensions');
      }
      const pipeline = collection.conversion ? image.resize(collection.conversion) : image;
      const outputInfo = await pipeline.webp({ quality: 82, effort: 4 }).toFile(outputPath);
      await chmod(outputPath, 0o600);
      const outputStat = await stat(outputPath);
      this.assertOutputSize(outputStat.size, collection.maxBytes, 'image');
      return {
        path: outputPath,
        filename: this.randomName('.webp'),
        mimeType: 'image/webp',
        size: outputStat.size,
        type: 'image',
        temporary: true,
        width: outputInfo.width,
        height: outputInfo.height,
      };
    } catch {
      await unlink(outputPath).catch(() => undefined);
      throw new BadRequestException('Could not safely process that image. Try a JPG, PNG, WebP, or GIF file.');
    }
  }

  private async processVideo(file: Express.Multer.File, maxBytes: number): Promise<ProcessedMedia> {
    const probe = await this.probe(file.path, 'video');
    const videoStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === 'video');
    const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === 'audio');
    if (
      videoStreams.length !== 1 ||
      audioStreams.length > 1 ||
      (probe.streams ?? []).some((stream) => !['video', 'audio'].includes(stream.codec_type ?? ''))
    ) {
      throw new BadRequestException('Video must contain one video stream, at most one audio stream, and no unsupported streams.');
    }
    const stream = videoStreams[0];
    const durationSeconds = this.mediaDuration(probe, stream);
    const frameRate = this.parseFrameRate(stream.avg_frame_rate ?? stream.r_frame_rate);
    if (
      !stream.width ||
      !stream.height ||
      frameRate <= 0 ||
      stream.width > MAX_VIDEO_WIDTH ||
      stream.height > MAX_VIDEO_HEIGHT ||
      frameRate > MAX_VIDEO_FRAME_RATE ||
      durationSeconds * frameRate > MAX_VIDEO_FRAMES
    ) {
      throw new BadRequestException('Video dimensions, duration, or frame rate exceed safe limits.');
    }
    const outputPath = this.randomPath('.mp4');
    await this.transcode(file.path, outputPath, [
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', 'scale=min(1280\\,iw):min(1280\\,ih):force_original_aspect_ratio=decrease',
      '-c:v', 'libx264',
      '-threads:v', '2',
      '-preset', 'veryfast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-threads:a', '1',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-f', 'mp4',
    ], 'video', maxBytes);
    const outputStat = await stat(outputPath);
    try {
      this.assertOutputSize(outputStat.size, maxBytes, 'video');
    } catch (error) {
      await unlink(outputPath).catch(() => undefined);
      throw error;
    }
    const outputProbe = await this.probe(outputPath, 'video');
    const outputStream = (outputProbe.streams ?? []).find((candidate) => candidate.codec_type === 'video');
    if (!outputStream?.width || !outputStream.height) {
      await unlink(outputPath).catch(() => undefined);
      throw new BadRequestException('Transcoded video metadata is unavailable.');
    }
    return {
      path: outputPath,
      filename: this.randomName('.mp4'),
      mimeType: 'video/mp4',
      size: outputStat.size,
      type: 'video',
      temporary: true,
      width: outputStream.width,
      height: outputStream.height,
      durationSeconds,
    };
  }

  private async processAudio(file: Express.Multer.File, maxBytes: number): Promise<ProcessedMedia> {
    const probe = await this.probe(file.path, 'audio');
    const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === 'audio');
    if (audioStreams.length !== 1 || (probe.streams ?? []).some((stream) => stream.codec_type !== 'audio')) {
      throw new BadRequestException('Audio must contain exactly one supported audio stream.');
    }
    const stream = audioStreams[0];
    const durationSeconds = this.mediaDuration(probe, stream);
    const sampleRate = Number(stream.sample_rate);
    const channels = stream.channels ?? 0;
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      sampleRate > 192_000 ||
      !Number.isInteger(channels) ||
      channels <= 0 ||
      channels > 8
    ) {
      throw new BadRequestException('Audio sample rate or channel count exceeds safe limits.');
    }
    const outputPath = this.randomPath('.m4a');
    await this.transcode(file.path, outputPath, [
      '-map', '0:a:0',
      '-vn',
      '-c:a', 'aac',
      '-threads:a', '1',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-f', 'mp4',
    ], 'audio', maxBytes);
    const outputStat = await stat(outputPath);
    try {
      this.assertOutputSize(outputStat.size, maxBytes, 'audio');
    } catch (error) {
      await unlink(outputPath).catch(() => undefined);
      throw error;
    }
    return {
      path: outputPath,
      filename: this.randomName('.m4a'),
      mimeType: 'audio/mp4',
      size: outputStat.size,
      type: 'audio',
      temporary: true,
      durationSeconds,
    };
  }

  private randomName(extension: string) {
    return `${randomBytes(24).toString('hex')}${extension}`;
  }

  private randomPath(extension: string) {
    return join(processingTempDirectory(), this.randomName(extension));
  }

  private async transcode(
    inputPath: string,
    outputPath: string,
    outputArgs: string[],
    kind: 'video' | 'audio',
    maxBytes: number,
  ) {
    try {
      await this.runCommand('ffmpeg', [
        '-nostdin',
        '-n',
        '-hide_banner',
        '-loglevel', 'error',
        '-threads', '2',
        '-filter_threads', '2',
        '-filter_complex_threads', '2',
        '-protocol_whitelist', 'file,pipe',
        '-i', inputPath,
        ...outputArgs,
        '-fs', String(maxBytes),
        outputPath,
      ], 0);
      await chmod(outputPath, 0o600);
    } catch {
      await unlink(outputPath).catch(() => undefined);
      throw new BadRequestException(`Could not safely process that ${kind}. Try a smaller or more common ${kind} file.`);
    }
  }

  private assertOutputSize(size: number, maxBytes: number, kind: 'image' | 'video' | 'audio') {
    if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) {
      const label = kind === 'image' ? 'Image' : kind === 'audio' ? 'Audio' : 'Video';
      throw new BadRequestException(`${label} output exceeds the collection size limit.`);
    }
  }

  private async probe(path: string, kind: 'video' | 'audio'): Promise<ProbeOutput> {
    try {
      const output = await this.runCommand('ffprobe', [
        '-v', 'error',
        '-show_format',
        '-show_streams',
        '-of', 'json',
        '-protocol_whitelist', 'file,pipe',
        path,
      ], MAX_PROBE_OUTPUT_BYTES);
      return JSON.parse(output) as ProbeOutput;
    } catch {
      throw new BadRequestException(`Could not inspect that ${kind}. Try a smaller or more common ${kind} file.`);
    }
  }

  private mediaDuration(probe: ProbeOutput, stream: ProbeStream) {
    const duration = Number(probe.format?.duration ?? stream.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_MEDIA_DURATION_SECONDS) {
      throw new BadRequestException('Media duration exceeds safe limits.');
    }
    return duration;
  }

  private parseFrameRate(value?: string) {
    if (!value) return 0;
    const [numerator, denominator = '1'] = value.split('/');
    const rate = Number(numerator) / Number(denominator);
    return Number.isFinite(rate) && rate >= 0 ? rate : Number.POSITIVE_INFINITY;
  }

  private runCommand(command: string, args: string[], maxOutputBytes: number) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let outputBytes = 0;
      let settled = false;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new Error(`${command} timed out`));
      }, PROCESS_TIMEOUT_MS);
      timer.unref();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(output);
      };
      child.on('error', finish);
      child.stdout?.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (maxOutputBytes === 0) return;
        if (outputBytes > maxOutputBytes) {
          child.kill('SIGKILL');
          finish(new Error(`${command} output exceeded limit`));
          return;
        }
        output += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > Math.max(maxOutputBytes, 64 * 1024)) {
          child.kill('SIGKILL');
          finish(new Error(`${command} error output exceeded limit`));
        }
      });
      child.on('close', (code) => {
        if (code === 0) finish();
        else finish(new Error(`${command} exited with code ${code ?? 'unknown'}`));
      });
    });
  }

  private async assertMagicBytes(path: string, mimeType: string) {
    const handle = await open(path, 'r');
    try {
      const b = Buffer.alloc(64);
      const { bytesRead } = await handle.read(b, 0, b.length, 0);
      const bytes = b.subarray(0, bytesRead);
      const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
      const isWebp = bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      const isGif = bytes.length > 6 && (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a');
      const isMp4Like = bytes.length > 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
      const isWebm = bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
      const isOgg = bytes.length > 4 && bytes.toString('ascii', 0, 4) === 'OggS';
      const isWav = bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
      const isMp3 = bytes.length > 3 && (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
      const isAac = bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0;
      const allowed =
        (mimeType === 'image/jpeg' && isJpeg) ||
        (mimeType === 'image/png' && isPng) ||
        (mimeType === 'image/webp' && isWebp) ||
        (mimeType === 'image/gif' && isGif) ||
        ((mimeType === 'video/mp4' || mimeType === 'video/quicktime') && isMp4Like) ||
        (mimeType === 'video/webm' && isWebm) ||
        (mimeType === 'audio/webm' && isWebm) ||
        (mimeType === 'audio/ogg' && isOgg) ||
        (mimeType === 'audio/wav' && isWav) ||
        (mimeType === 'audio/mp4' && isMp4Like) ||
        (mimeType === 'audio/mpeg' && isMp3) ||
        (mimeType === 'audio/aac' && isAac);
      if (!allowed) throw new BadRequestException('Uploaded file content does not match its media type.');
    } finally {
      await handle.close();
    }
  }
}
