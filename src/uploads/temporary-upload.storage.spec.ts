import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import {
  TemporaryUploadStorage,
  cleanupStaleTemporaryUploads,
  temporaryUploadDirectory,
} from './temporary-upload.storage';

describe('TemporaryUploadStorage', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'swebudd-incoming-test-'));
  });

  afterEach(() => {
    delete process.env.MEDIA_UPLOAD_TEMP_DIR;
    delete process.env.MEDIA_PROCESSING_TEMP_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('uses an unpredictable extensionless owner-only file and removes it', async () => {
    const directory = join(root, 'incoming');
    mkdirSync(directory, { mode: 0o700 });
    const storage = new TemporaryUploadStorage(directory);
    const file = {
      originalname: '../../client-name.jpg.exe',
      stream: Readable.from(Buffer.from('streamed bytes')),
    } as Express.Multer.File;
    const info = await new Promise<Partial<Express.Multer.File>>((resolve, reject) => {
      storage._handleFile({} as never, file, (error, stored) => error ? reject(error) : resolve(stored!));
    });

    expect(info.filename).toMatch(/^[a-f0-9]{64}$/);
    expect(info.path).toBe(join(directory, info.filename!));
    expect(info.path).not.toContain('client-name');
    expect(readFileSync(info.path!)).toEqual(Buffer.from('streamed bytes'));
    expect(statSync(info.path!).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);

    await new Promise<void>((resolve, reject) => {
      storage._removeFile({} as never, { ...file, path: info.path } as Express.Multer.File, (error) => error ? reject(error) : resolve());
    });
    expect(() => statSync(info.path!)).toThrow();
  });

  it('rejects a configured incoming directory which is a symlink', () => {
    const target = join(root, 'target');
    const link = join(root, 'link');
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, link);
    process.env.MEDIA_UPLOAD_TEMP_DIR = link;

    expect(() => temporaryUploadDirectory()).toThrow('may not traverse symlinks');
  });

  it('removes only stale storage-owned temporary files', () => {
    const directory = join(root, 'incoming');
    mkdirSync(directory, { mode: 0o700 });
    const stale = join(directory, 'a'.repeat(64));
    const fresh = join(directory, 'b'.repeat(64));
    const unrelated = join(directory, 'keep-me');
    writeFileSync(stale, 'stale', { mode: 0o600 });
    writeFileSync(fresh, 'fresh', { mode: 0o600 });
    writeFileSync(unrelated, 'unrelated', { mode: 0o600 });
    utimesSync(stale, new Date(0), new Date(0));

    expect(cleanupStaleTemporaryUploads(directory, 7 * 60 * 60 * 1000)).toBe(1);
    expect(() => statSync(stale)).toThrow();
    expect(statSync(fresh).isFile()).toBe(true);
    expect(statSync(unrelated).isFile()).toBe(true);
  });
});
