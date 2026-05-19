import { ForbiddenException, HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { IncomingMessage } from 'http';
import { booleanConfig } from './config';

const weakSecretValues = new Set([
  '',
  'dev-secret',
  'dev-refresh-secret',
  'change-me',
  'change-me-in-production',
  'change-me-too',
]);

function isLocalOrigin(origin: string) {
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
  if (process.env.NODE_ENV === 'production' && (weakSecretValues.has(value) || value.length < 32)) {
    throw new Error(`${key} must be set to a strong secret in production.`);
  }
  return value;
}

export function allowedOrigins(config: ConfigService) {
  return [config.get<string>('FRONTEND_ORIGIN'), config.get<string>('ADMIN_ORIGIN')]
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
    credentials: false,
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

  const requiredKeys = ['DATABASE_URL', 'FRONTEND_ORIGIN'];
  const missing = requiredKeys.filter((key) => !config.get<string>(key)?.trim());
  if (missing.length) throw new Error(`Missing required production env: ${missing.join(', ')}`);

  const invalidOrigins = allowedOrigins(config).filter((origin) => {
    try {
      const parsed = new URL(origin);
      return !['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol !== 'https:' && !isLocalOrigin(origin));
    } catch {
      return true;
    }
  });
  if (invalidOrigins.length) throw new Error(`FRONTEND_ORIGIN/ADMIN_ORIGIN must use HTTPS in production: ${invalidOrigins.join(', ')}`);

  const smtpPort = numericEnv(config, 'SMTP_PORT');
  if (smtpPort != null && (smtpPort < 1 || smtpPort > 65535)) throw new Error('SMTP_PORT must be between 1 and 65535.');

  const mediaDriver = (config.get<string>('MEDIA_STORAGE_DRIVER') ?? 'local').trim();
  if (!['local', 's3'].includes(mediaDriver)) throw new Error('MEDIA_STORAGE_DRIVER must be "local" or "s3".');
  if (mediaDriver === 's3') {
    const s3Required = ['MEDIA_S3_BUCKET', 'MEDIA_PUBLIC_BASE_URL'];
    const s3Missing = s3Required.filter((key) => !config.get<string>(key)?.trim());
    if (s3Missing.length) throw new Error(`Missing required S3 media env: ${s3Missing.join(', ')}`);
  }
}

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private buckets = new Map<string, RateLimitBucket>();

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
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    existing.count += 1;
    if (existing.count > limit) throw new HttpException('Too many requests. Please slow down and try again.', HttpStatus.TOO_MANY_REQUESTS);
    next();
  }
}
