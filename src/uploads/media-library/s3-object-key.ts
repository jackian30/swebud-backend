import { ConfigService } from '@nestjs/config';

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function mediaS3Prefix(config: ConfigService) {
  const prefix = config.get<string>('MEDIA_S3_PREFIX') ?? '';
  if (
    prefix.startsWith('/') ||
    prefix.includes('..') ||
    hasControlCharacter(prefix) ||
    (prefix.length > 0 && !prefix.endsWith('/'))
  ) {
    throw new Error(
      "MEDIA_S3_PREFIX must be relative, cannot contain '..' or control characters, and must end in '/' when nonempty.",
    );
  }
  return prefix;
}

export function publicMediaObjectKey(config: ConfigService, key: string) {
  const components = key.split('/');
  if (
    !key ||
    key.startsWith('/') ||
    hasControlCharacter(key) ||
    components.some((component) => !component || component === '.' || component === '..')
  ) {
    throw new Error('Public media object key is unsafe.');
  }
  return `${mediaS3Prefix(config)}${key}`;
}
