import { ForbiddenException, HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { IncomingMessage } from 'http';
import { isAbsolute, resolve } from 'path';
import {
  accessTokenTtlSeconds,
  adminJwtAudience,
  adminJwtIssuer,
  booleanConfig,
  emailVerificationResendCooldownSeconds,
  emailVerificationTtlSeconds,
  minimumAccountAge,
  refreshTokenTtlSeconds,
} from './config';
import { isCanonicalSweBuddRenderService } from './render-identity';

const weakSecretValues = new Set([
  '',
  'dev-secret',
  'dev-refresh-secret',
  'change-me',
  'change-me-in-production',
  'change-me-too',
]);

export function isLocalOrigin(origin: string) {
  return /^https?:\/\/(localhost|[a-z0-9.-]+\.loc|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin);
}

function numericEnv(config: ConfigService, key: string) {
  const raw = config.get<string | number>(key);
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

export function requiredSecret(config: ConfigService, key: string, fallback: string) {
  const value = (config.get<string>(key) ?? fallback).trim();
  const placeholder = /^(?:your[-_ ]|example[-_ ]|test[-_ ]|placeholder)/i.test(value);
  if (process.env.NODE_ENV === 'production' && (weakSecretValues.has(value) || placeholder || value.length < 32)) {
    throw new Error(`${key} must be set to a strong secret in production.`);
  }
  return value;
}

export function allowedOrigins(config: ConfigService) {
  const nativeOrigin = booleanConfig(config, 'NATIVE_AUTH_ENABLED', false)
    ? config.get<string>('NATIVE_APP_ORIGIN')
    : undefined;
  return [config.get<string>('FRONTEND_ORIGIN'), config.get<string>('ADMIN_ORIGIN'), nativeOrigin]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function allowLocalOrigins(config: ConfigService) {
  return booleanConfig(config, 'ALLOW_LOCAL_ORIGINS', process.env.NODE_ENV !== 'production');
}

export function isAllowedOrigin(config: ConfigService, origin?: string) {
  if (!origin) return true;
  const allowed = allowedOrigins(config);
  if (allowed.includes(origin)) return true;
  if (allowLocalOrigins(config) && isLocalOrigin(origin)) return true;
  return !allowed.length && process.env.NODE_ENV !== 'production';
}

export function corsOrigin(config: ConfigService) {
  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (isAllowedOrigin(config, origin)) return callback(null, true);
    callback(new ForbiddenException('Origin is not allowed'), false);
  };
}

export function bearerCorsOptions(config: ConfigService) {
  return {
    origin: corsOrigin(config),
    credentials: true,
    maxAge: 600,
  };
}

export function websocketAllowRequest(config: ConfigService) {
  return (req: IncomingMessage, callback: (err: string | null, success: boolean) => void) => {
    const origin = req.headers.origin;
    if (isAllowedOrigin(config, Array.isArray(origin) ? origin[0] : origin)) return callback(null, true);
    callback('Origin is not allowed', false);
  };
}

export function assertProductionConfig(config: ConfigService) {
  if (process.env.NODE_ENV !== 'production') return;

  const jwtSecret = requiredSecret(config, 'JWT_SECRET', '');
  const jwtRefreshSecret = requiredSecret(config, 'JWT_REFRESH_SECRET', '');
  if (jwtSecret === jwtRefreshSecret) throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different in production.');
  const adminJwtSecret = requiredSecret(config, 'ADMIN_JWT_SECRET', '');
  if (adminJwtSecret === jwtSecret || adminJwtSecret === jwtRefreshSecret) {
    throw new Error('ADMIN_JWT_SECRET must be different from user access and refresh JWT secrets in production.');
  }
  adminJwtIssuer(config);
  adminJwtAudience(config);
  accessTokenTtlSeconds(config);
  refreshTokenTtlSeconds(config);
  const configuredMinimumAge = minimumAccountAge(config);
  if (configuredMinimumAge < 18) {
    throw new Error('MINIMUM_ACCOUNT_AGE must be at least 18 in production; minor accounts are not supported.');
  }
  emailVerificationTtlSeconds(config);
  emailVerificationResendCooldownSeconds(config);

  const requiredKeys = [
    'DATABASE_URL',
    'FRONTEND_ORIGIN',
    'SMTP_HOST',
    'MAIL_FROM',
    'CLOUDFLARE_TURNSTILE_SECRET_KEY',
  ];
  const missing = requiredKeys.filter((key) => !config.get<string>(key)?.trim());
  if (missing.length) throw new Error(`Missing required production env: ${missing.join(', ')}`);
  requiredSecret(config, 'CLOUDFLARE_TURNSTILE_SECRET_KEY', '');

  if (allowLocalOrigins(config)) throw new Error('ALLOW_LOCAL_ORIGINS must be false in production.');
  const canonicalRenderService = isCanonicalSweBuddRenderService({
    RENDER: config.get<string>('RENDER'),
    RENDER_SERVICE_NAME: config.get<string>('RENDER_SERVICE_NAME'),
    RENDER_SERVICE_TYPE: config.get<string>('RENDER_SERVICE_TYPE'),
    RENDER_GIT_REPO_SLUG: config.get<string>('RENDER_GIT_REPO_SLUG'),
    RENDER_GIT_BRANCH: config.get<string>('RENDER_GIT_BRANCH'),
    IS_PULL_REQUEST: config.get<string>('IS_PULL_REQUEST'),
  });
  const nativeEmergencySetting = config.get<string>('SWEBUDD_NATIVE_AUTH_EMERGENCY_DISABLED')?.trim();
  if (nativeEmergencySetting && !['true', 'false'].includes(nativeEmergencySetting)) {
    throw new Error('SWEBUDD_NATIVE_AUTH_EMERGENCY_DISABLED must be "true" or "false" when set.');
  }
  if (canonicalRenderService) {
    const nativeEnabled = booleanConfig(config, 'NATIVE_AUTH_ENABLED', false);
    const nativeOrigin = config.get<string>('NATIVE_APP_ORIGIN')?.trim();
    if (nativeEmergencySetting === 'true') {
      if (nativeEnabled) throw new Error('SweBudd Render native auth must be disabled while the emergency switch is active.');
    } else if (!nativeEnabled || nativeOrigin !== 'https://localhost') {
      throw new Error('SweBudd Render requires native auth on the exact https://localhost origin.');
    }
  }
  const publicOrigins = (['FRONTEND_ORIGIN', 'ADMIN_ORIGIN'] as const).flatMap((key) =>
    (config.get<string>(key) ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => ({ key, origin })),
  );
  const invalidOrigins = publicOrigins.filter(({ origin }) => !isPublicHttpsOrigin(origin));
  if (invalidOrigins.length) {
    const invalidValues = invalidOrigins.map(({ key, origin }) => `${key}=${origin}`);
    throw new Error(`FRONTEND_ORIGIN/ADMIN_ORIGIN must use HTTPS in production: ${invalidValues.join(', ')}`);
  }
  if (booleanConfig(config, 'NATIVE_AUTH_ENABLED', false)) {
    const nativeOrigin = config.get<string>('NATIVE_APP_ORIGIN')?.trim();
    if (!nativeOrigin) throw new Error('Missing required production env: NATIVE_APP_ORIGIN');
    if (!['https://localhost', 'capacitor://localhost'].includes(nativeOrigin)) {
      throw new Error('NATIVE_APP_ORIGIN must be an exact trusted Capacitor origin.');
    }
    const legacyCompatUntil = config.get<string>('LEGACY_NATIVE_AUTH_COMPAT_UNTIL')?.trim();
    if (legacyCompatUntil && !Number.isFinite(Date.parse(legacyCompatUntil))) {
      throw new Error('LEGACY_NATIVE_AUTH_COMPAT_UNTIL must be a valid ISO timestamp.');
    }
  }
  const legacyWebCompatUntil = config.get<string>('LEGACY_WEB_AUTH_COMPAT_UNTIL')?.trim();
  if (legacyWebCompatUntil && !Number.isFinite(Date.parse(legacyWebCompatUntil))) {
    throw new Error('LEGACY_WEB_AUTH_COMPAT_UNTIL must be a valid ISO timestamp.');
  }

  const smtpPort = numericEnv(config, 'SMTP_PORT');
  if (smtpPort != null && (smtpPort < 1 || smtpPort > 65535)) throw new Error('SMTP_PORT must be between 1 and 65535.');
  const smtpHost = config.get<string>('SMTP_HOST')?.trim().toLowerCase();
  if (smtpHost === 'mailhog' || smtpHost === 'localhost' || smtpHost === '127.0.0.1') {
    throw new Error('SMTP_HOST must use a production mail service.');
  }
  if (booleanConfig(config, 'SMTP_IGNORE_TLS', false) || !booleanConfig(config, 'SMTP_REQUIRE_TLS', true)) {
    throw new Error('Production SMTP must require TLS and must not ignore TLS.');
  }
  if (!booleanConfig(config, 'SMTP_TLS_REJECT_UNAUTHORIZED', true)) {
    throw new Error('Production SMTP must verify TLS certificates.');
  }
  if (config.get<string>('MAIL_FROM')?.toLowerCase().includes('localhost')) {
    throw new Error('MAIL_FROM must use a verified non-localhost sender.');
  }

  const mediaDriver = (config.get<string>('MEDIA_STORAGE_DRIVER') ?? 'local').trim().toLowerCase();
  if (!['local', 's3'].includes(mediaDriver)) throw new Error('MEDIA_STORAGE_DRIVER must be "local" or "s3".');
  if (mediaDriver !== 's3') throw new Error('MEDIA_STORAGE_DRIVER must be "s3" in production.');
  const s3Required = [
    'AWS_REGION',
    'MEDIA_S3_BUCKET',
    'MEDIA_PUBLIC_BASE_URL',
  ];
  const s3Missing = s3Required.filter((key) => !config.get<string>(key)?.trim());
  if (s3Missing.length) throw new Error(`Missing required S3 media env: ${s3Missing.join(', ')}`);
  const publicBucket = config.get<string>('MEDIA_S3_BUCKET')!.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(publicBucket)) {
    throw new Error('MEDIA_S3_BUCKET must be a valid S3 bucket name.');
  }
  assertHttpsUrl(config.get<string>('MEDIA_PUBLIC_BASE_URL')!, 'MEDIA_PUBLIC_BASE_URL');
  const s3Endpoint = config.get<string>('AWS_S3_ENDPOINT')?.trim();
  if (s3Endpoint) assertHttpsUrl(s3Endpoint, 'AWS_S3_ENDPOINT');

  const processingConcurrency = numericEnv(config, 'MEDIA_PROCESSING_CONCURRENCY');
  if (processingConcurrency != null && (processingConcurrency < 1 || processingConcurrency > 8)) {
    throw new Error('MEDIA_PROCESSING_CONCURRENCY must be between 1 and 8.');
  }
  const processingMaxQueue = numericEnv(config, 'MEDIA_PROCESSING_MAX_QUEUE');
  if (processingMaxQueue != null && (processingMaxQueue < 0 || processingMaxQueue > 100)) {
    throw new Error('MEDIA_PROCESSING_MAX_QUEUE must be between 0 and 100.');
  }
  const processingTemp = config.get<string>('MEDIA_PROCESSING_TEMP_DIR')?.trim();
  if (!processingTemp) throw new Error('Missing required production env: MEDIA_PROCESSING_TEMP_DIR');
  if (!isAbsolute(processingTemp)) throw new Error('MEDIA_PROCESSING_TEMP_DIR must be an absolute path in production.');
  const resolvedProcessingTemp = resolve(processingTemp);
  const publicUploads = resolve(process.cwd(), 'uploads');
  if (
    resolvedProcessingTemp === '/tmp' ||
    resolvedProcessingTemp.startsWith('/tmp/') ||
    resolvedProcessingTemp === publicUploads ||
    resolvedProcessingTemp.startsWith(`${publicUploads}/`)
  ) {
    throw new Error('MEDIA_PROCESSING_TEMP_DIR must use a dedicated disk-backed path outside /tmp and public uploads.');
  }
}

function assertHttpsUrl(value: string, key: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
  } catch {
    throw new Error(`${key} must be an HTTPS URL without credentials, query, or fragment.`);
  }
}

function isPublicHttpsOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    if (origin.endsWith('/')) return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.loc')) return false;
    if (host === '::1' || /^(?:fc|fd)/.test(host) || /^(?:fe8|fe9|fea|feb)/.test(host)) return false;
    const octets = host.split('.').map(Number);
    if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b] = octets;
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168)) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
    }
    return true;
  } catch {
    return false;
  }
}

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_PRUNE_INTERVAL_MS = 60_000;
const RATE_LIMIT_MAX_BUCKETS = 10_000;

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private buckets = new Map<string, RateLimitBucket>();
  private lastPruneAt = 0;

  use(req: Request, _res: Response, next: NextFunction) {
    const path = req.path || req.url || '/';
    const isAuth = path.startsWith('/auth/');
    const isUpload = path.startsWith('/uploads');
    const isHealth = path === '/health' || path === '/api/health';
    const limit = isHealth ? 600 : isAuth ? 12 : isUpload ? 60 : 300;
    const windowMs = isAuth ? 60_000 : 60_000;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${isAuth ? path : isUpload ? 'uploads' : 'api'}`;
    const now = Date.now();
    this.pruneBuckets(now);
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    existing.count += 1;
    if (existing.count > limit) throw new HttpException('Too many requests. Please slow down and try again.', HttpStatus.TOO_MANY_REQUESTS);
    next();
  }

  private pruneBuckets(now: number) {
    if (now - this.lastPruneAt < RATE_LIMIT_PRUNE_INTERVAL_MS && this.buckets.size <= RATE_LIMIT_MAX_BUCKETS) return;
    this.lastPruneAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size <= RATE_LIMIT_MAX_BUCKETS) return;

    let overflow = this.buckets.size - RATE_LIMIT_MAX_BUCKETS;
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      overflow -= 1;
      if (overflow <= 0) break;
    }
  }
}
