import { readFileSync } from 'fs';
import { join } from 'path';

type PackageManifest = {
  version?: unknown;
};

let cachedVersion: string | undefined;

export function appVersion() {
  cachedVersion ??= packageVersion() ?? '0.0.0';
  return cachedVersion;
}

export function isBetaReleaseVersion(version = appVersion()) {
  return version.toLowerCase().includes('beta');
}

function packageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as PackageManifest;
    return typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : undefined;
  } catch {
    return undefined;
  }
}
