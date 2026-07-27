import { randomBytes } from 'crypto';
import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, unlinkSync } from 'fs';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import type { Request } from 'express';

const DEFAULT_DIRECTORY_NAME = 'swebudd-upload-incoming';
const STALE_UPLOAD_AGE_MS = 6 * 60 * 60 * 1000;
const STALE_UPLOAD_CLEANUP_LIMIT = 100;

export function cleanupStaleTemporaryUploads(
  directory: string,
  now = Date.now(),
  maxAgeMs = STALE_UPLOAD_AGE_MS,
  limit = STALE_UPLOAD_CLEANUP_LIMIT,
) {
  let removed = 0;
  for (const name of readdirSync(directory)) {
    if (removed >= limit || !/^[a-f0-9]{64}$/.test(name)) continue;
    const path = join(directory, name);
    try {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || now - info.mtimeMs < maxAgeMs) continue;
      unlinkSync(path);
      removed += 1;
    } catch {
      // A concurrent request or restart cleanup may already have removed it.
    }
  }
  return removed;
}

export function temporaryUploadDirectory() {
  const configured = process.env.MEDIA_UPLOAD_TEMP_DIR?.trim();
  const directory = configured
    ? (isAbsolute(configured) ? configured : resolve(process.cwd(), configured))
    : process.env.MEDIA_PROCESSING_TEMP_DIR?.trim()
      ? join(resolve(process.env.MEDIA_PROCESSING_TEMP_DIR), 'incoming')
      : join(tmpdir(), DEFAULT_DIRECTORY_NAME);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== resolve(directory)) {
    throw new Error('MEDIA_UPLOAD_TEMP_DIR must be a real directory and may not traverse symlinks.');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('MEDIA_UPLOAD_TEMP_DIR must be owned by the application user.');
  }
  chmodSync(directory, 0o700);
  return directory;
}

/**
 * Temporary Multer storage which never derives a path or extension from client input.
 * Files are opened exclusively and owner-only so a predictable/symlink target
 * cannot be overwritten even if the incoming directory is misconfigured.
 */
export class TemporaryUploadStorage {
  readonly directory: string;

  constructor(directory = temporaryUploadDirectory()) {
    this.directory = directory;
    cleanupStaleTemporaryUploads(directory);
  }

  _handleFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ) {
    const filename = randomBytes(32).toString('hex');
    const path = join(this.directory, filename);
    const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    let size = 0;
    file.stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
    });
    void pipeline(file.stream, output)
      .then(() => callback(undefined, {
        destination: this.directory,
        filename,
        path,
        size,
      }))
      .catch(async (error: unknown) => {
        await unlink(path).catch(() => undefined);
        callback(error);
      });
  }

  _removeFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ) {
    if (!file.path) return callback(null);
    void unlink(file.path)
      .then(() => callback(null))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return callback(null);
        callback(error);
      });
  }
}

export const temporaryUploadStorage = new TemporaryUploadStorage();
