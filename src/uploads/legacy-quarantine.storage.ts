import { randomBytes } from 'crypto';
import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'fs';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import type { Request } from 'express';

const DEFAULT_DIRECTORY_NAME = 'swebudd-legacy-upload-quarantine';

export function legacyQuarantineDirectory() {
  const configured = process.env.MEDIA_LEGACY_QUARANTINE_DIR?.trim();
  const directory = configured
    ? (isAbsolute(configured) ? configured : resolve(process.cwd(), configured))
    : join(tmpdir(), DEFAULT_DIRECTORY_NAME);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== resolve(directory)) {
    throw new Error('MEDIA_LEGACY_QUARANTINE_DIR must be a real directory and may not traverse symlinks.');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('MEDIA_LEGACY_QUARANTINE_DIR must be owned by the application user.');
  }
  chmodSync(directory, 0o700);
  return directory;
}

/**
 * Multer storage which never derives a path or extension from client input.
 * Files are opened exclusively and owner-only so a predictable/symlink target
 * cannot be overwritten even if the quarantine directory is misconfigured.
 */
export class LegacyQuarantineStorage {
  readonly directory: string;

  constructor(directory = legacyQuarantineDirectory()) {
    this.directory = directory;
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

export const legacyQuarantineStorage = new LegacyQuarantineStorage();
