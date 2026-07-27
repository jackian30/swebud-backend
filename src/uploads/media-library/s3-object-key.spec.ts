import { ConfigService } from '@nestjs/config';
import { mediaS3Prefix, publicMediaObjectKey } from './s3-object-key';

describe('S3 public media object keys', () => {
  it('persists public objects under the configured backup prefix', () => {
    const config = configWith({ MEDIA_S3_PREFIX: 'tenant/media/' });

    expect(mediaS3Prefix(config)).toBe('tenant/media/');
    expect(publicMediaObjectKey(config, 'posts/v2/asset/output.webp'))
      .toBe('tenant/media/posts/v2/asset/output.webp');
  });

  it('keeps existing object keys unchanged when no prefix is configured', () => {
    expect(publicMediaObjectKey(configWith({}), 'images/output.webp'))
      .toBe('images/output.webp');
  });

  it.each([
    '/absolute/',
    'missing-trailing-slash',
    '../escape/',
    'safe/../escape/',
    'control\u0000/',
  ])('rejects an unsafe public prefix: %s', (prefix) => {
    expect(() => mediaS3Prefix(configWith({ MEDIA_S3_PREFIX: prefix })))
      .toThrow('MEDIA_S3_PREFIX');
  });

  it.each([
    '',
    '/absolute',
    '../escape',
    'posts//output.webp',
    'posts/./output.webp',
    'posts/\u0000/output.webp',
  ])('rejects an unsafe generated key: %s', (key) => {
    expect(() => publicMediaObjectKey(configWith({}), key))
      .toThrow('object key is unsafe');
  });
});

function configWith(values: Record<string, string>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}
