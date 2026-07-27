import { ConfigService } from '@nestjs/config';
import {
  accessTokenTtlSeconds,
  adminJwtAudience,
  adminJwtIssuer,
  ADMIN_JWT_MAX_TTL_SECONDS,
  booleanConfig,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
  DEFAULT_EMAIL_VERIFICATION_TTL_SECONDS,
  DEFAULT_MINIMUM_ACCOUNT_AGE,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  emailVerificationResendCooldownSeconds,
  emailVerificationTtlSeconds,
  minimumAccountAge,
  refreshTokenTtlSeconds,
} from './config';

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

  it('defaults the public account policy to adults and accepts bounded overrides', () => {
    expect(minimumAccountAge(config({}))).toBe(DEFAULT_MINIMUM_ACCOUNT_AGE);
    expect(minimumAccountAge(config({ MINIMUM_ACCOUNT_AGE: '21' }))).toBe(21);
    expect(() => minimumAccountAge(config({ MINIMUM_ACCOUNT_AGE: '12' })))
      .toThrow('between 13 and 120');
  });

  it('bounds email-verification expiry and resend cooldown settings', () => {
    expect(emailVerificationTtlSeconds(config({}))).toBe(DEFAULT_EMAIL_VERIFICATION_TTL_SECONDS);
    expect(emailVerificationResendCooldownSeconds(config({})))
      .toBe(DEFAULT_EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS);
    expect(emailVerificationTtlSeconds(config({ EMAIL_VERIFICATION_TTL_SECONDS: '3600' }))).toBe(3600);
    expect(emailVerificationResendCooldownSeconds(config({
      EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: '120',
    }))).toBe(120);
    expect(() => emailVerificationTtlSeconds(config({ EMAIL_VERIFICATION_TTL_SECONDS: '60' })))
      .toThrow('between 300 and 604800');
    expect(() => emailVerificationResendCooldownSeconds(config({
      EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: '10',
    }))).toThrow('between 30 and 86400');
  });

  it('uses strict admin JWT identifiers and caps token lifetime at five minutes', () => {
    expect(ADMIN_JWT_MAX_TTL_SECONDS).toBe(300);
    expect(adminJwtIssuer(config({}))).toBe('swebudd-admin');
    expect(adminJwtAudience(config({}))).toBe('swebudd-admin-moderation');
    expect(adminJwtIssuer(config({ ADMIN_JWT_ISSUER: 'https://identity.example.com/admin' })))
      .toBe('https://identity.example.com/admin');
    expect(() => adminJwtAudience(config({ ADMIN_JWT_AUDIENCE: 'bad audience' })))
      .toThrow('URI-safe identifier');
  });
});
