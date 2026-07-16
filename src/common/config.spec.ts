import { ConfigService } from '@nestjs/config';
import { accessTokenTtlSeconds, booleanConfig, DEFAULT_ACCESS_TOKEN_TTL_SECONDS, DEFAULT_REFRESH_TOKEN_TTL_SECONDS, refreshTokenTtlSeconds } from './config';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('config helpers', () => {
  it('parses common enabled boolean env values', () => {
    expect(booleanConfig(config({ FEATURE_FLAG: ' yes ' }), 'FEATURE_FLAG')).toBe(true);
    expect(booleanConfig(config({ FEATURE_FLAG: 'ON' }), 'FEATURE_FLAG')).toBe(true);
  });

  it('uses fallback for missing or empty values', () => {
    expect(booleanConfig(config({}), 'FEATURE_FLAG', true)).toBe(true);
    expect(booleanConfig(config({ FEATURE_FLAG: '' }), 'FEATURE_FLAG', true)).toBe(true);
  });

  it('treats other configured values as false', () => {
    expect(booleanConfig(config({ FEATURE_FLAG: 'false' }), 'FEATURE_FLAG', true)).toBe(false);
  });

  it('defaults access tokens to fifteen minutes and accepts a bounded override', () => {
    expect(accessTokenTtlSeconds(config({}))).toBe(DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
    expect(accessTokenTtlSeconds(config({ JWT_ACCESS_TTL_SECONDS: '1200' }))).toBe(1200);
  });

  it('rejects access-token lifetimes longer than one hour', () => {
    expect(() => accessTokenTtlSeconds(config({ JWT_ACCESS_TTL_SECONDS: '86400' })))
      .toThrow('between 60 and 3600');
  });

  it('aligns refresh tokens and DB sessions to a seven-day default', () => {
    expect(refreshTokenTtlSeconds(config({}))).toBe(DEFAULT_REFRESH_TOKEN_TTL_SECONDS);
    expect(refreshTokenTtlSeconds(config({ REFRESH_TOKEN_TTL_SECONDS: '86400' }))).toBe(86400);
  });

  it('rejects refresh-token lifetimes longer than thirty days', () => {
    expect(() => refreshTokenTtlSeconds(config({ REFRESH_TOKEN_TTL_SECONDS: '2592001' })))
      .toThrow('between 3600 and 2592000');
  });
});
