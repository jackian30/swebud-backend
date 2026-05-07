import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mediaCollections } from './collections';
import { ProcessedMedia } from './types';

describe('LocalStorageDriver', () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'swebud-media-library-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
  });

  it('stores files under uploads with stable key, url, and local path shapes', async () => {
    const { LocalStorageDriver } = await import('./local-storage.driver');
    const driver = new LocalStorageDriver();
    const media: ProcessedMedia = {
      buffer: Buffer.from('stored bytes'),
      filename: 'avatar.webp',
      mimeType: 'image/webp',
      size: 12,
      type: 'image',
    };

    const stored = await driver.put(mediaCollections['profile-photo'], media);

    expect(stored).toEqual({
      key: 'profile-photos/avatar.webp',
      url: '/api/uploads/profile-photos/avatar.webp',
      path: '/uploads/profile-photos/avatar.webp',
    });
    expect(readFileSync(join(tempDir, 'uploads', 'profile-photos', 'avatar.webp'))).toEqual(Buffer.from('stored bytes'));
  });
});
