import { ConfigService } from '@nestjs/config';

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

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
