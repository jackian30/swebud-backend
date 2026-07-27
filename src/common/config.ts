import { ConfigService } from '@nestjs/config';

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_MINIMUM_ACCOUNT_AGE = 18;
export const DEFAULT_EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
export const ADMIN_JWT_MAX_TTL_SECONDS = 5 * 60;
export const DEFAULT_ADMIN_JWT_SECRET = 'local-admin-moderation-secret-not-for-production';
export const DEFAULT_ADMIN_JWT_ISSUER = 'swebudd-admin';
export const DEFAULT_ADMIN_JWT_AUDIENCE = 'swebudd-admin-moderation';

export function booleanConfig(config: ConfigService, key: string, fallback = false) {
  const raw = config.get<string>(key);
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

export function accessTokenTtlSeconds(config: ConfigService) {
  const raw = config.get<string | number>('JWT_ACCESS_TTL_SECONDS');
  if (raw == null || raw === '') return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 60 * 60) {
    throw new Error('JWT_ACCESS_TTL_SECONDS must be an integer between 60 and 3600.');
  }
  return ttl;
}

export function refreshTokenTtlSeconds(config: ConfigService) {
  const raw = config.get<string | number>('REFRESH_TOKEN_TTL_SECONDS');
  if (raw == null || raw === '') return DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl < 60 * 60 || ttl > 30 * 24 * 60 * 60) {
    throw new Error('REFRESH_TOKEN_TTL_SECONDS must be an integer between 3600 and 2592000.');
  }
  return ttl;
}

export function minimumAccountAge(config?: ConfigService) {
  const raw = typeof config?.get === 'function'
    ? config.get<string | number>('MINIMUM_ACCOUNT_AGE')
    : undefined;
  if (raw == null || raw === '') return DEFAULT_MINIMUM_ACCOUNT_AGE;
  const age = Number(raw);
  if (!Number.isInteger(age) || age < 13 || age > 120) {
    throw new Error('MINIMUM_ACCOUNT_AGE must be an integer between 13 and 120.');
  }
  return age;
}

export function emailVerificationTtlSeconds(config: ConfigService) {
  const raw = config.get<string | number>('EMAIL_VERIFICATION_TTL_SECONDS');
  if (raw == null || raw === '') return DEFAULT_EMAIL_VERIFICATION_TTL_SECONDS;
  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl < 5 * 60 || ttl > 7 * 24 * 60 * 60) {
    throw new Error('EMAIL_VERIFICATION_TTL_SECONDS must be an integer between 300 and 604800.');
  }
  return ttl;
}

export function emailVerificationResendCooldownSeconds(config: ConfigService) {
  const raw = config.get<string | number>('EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS');
  if (raw == null || raw === '') return DEFAULT_EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS;
  const cooldown = Number(raw);
  if (!Number.isInteger(cooldown) || cooldown < 30 || cooldown > 24 * 60 * 60) {
    throw new Error('EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS must be an integer between 30 and 86400.');
  }
  return cooldown;
}

function adminJwtIdentifier(config: ConfigService, key: string, fallback: string) {
  const value = (config.get<string>(key) ?? fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/.test(value)) {
    throw new Error(`${key} must be a 3-128 character URI-safe identifier.`);
  }
  return value;
}

export function adminJwtIssuer(config: ConfigService) {
  return adminJwtIdentifier(config, 'ADMIN_JWT_ISSUER', DEFAULT_ADMIN_JWT_ISSUER);
}

export function adminJwtAudience(config: ConfigService) {
  return adminJwtIdentifier(config, 'ADMIN_JWT_AUDIENCE', DEFAULT_ADMIN_JWT_AUDIENCE);
}
