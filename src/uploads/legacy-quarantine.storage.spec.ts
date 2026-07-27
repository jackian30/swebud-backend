import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import {
  LegacyQuarantineStorage,
  legacyQuarantineDirectory,
} from './legacy-quarantine.storage';

describe('LegacyQuarantineStorage', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'swebudd-quarantine-test-'));
  });

  afterEach(() => {
    delete process.env.MEDIA_LEGACY_QUARANTINE_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('uses an unpredictable extensionless owner-only file and removes it', async () => {
    const directory = join(root, 'quarantine');
    mkdirSync(directory, { mode: 0o700 });
    const storage = new LegacyQuarantineStorage(directory);
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

  it('rejects a configured quarantine directory which is a symlink', () => {
    const target = join(root, 'target');
    const link = join(root, 'link');
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, link);
    process.env.MEDIA_LEGACY_QUARANTINE_DIR = link;

    expect(() => legacyQuarantineDirectory()).toThrow('may not traverse symlinks');
  });
});
