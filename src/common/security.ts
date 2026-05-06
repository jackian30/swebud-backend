import { ForbiddenException, HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

const weakSecretValues = new Set([
  '',
  'dev-secret',
  'dev-refresh-secret',
  'change-me',
  'change-me-in-production',
  'change-me-too',
]);

export function requiredSecret(config: ConfigService, key: string, fallback: string) {
  const value = (config.get<string>(key) ?? fallback).trim();
  if (process.env.NODE_ENV === 'production' && (weakSecretValues.has(value) || value.length < 32)) {
    throw new Error(`${key} must be set to a strong secret in production.`);
  }
  return value;
}

export function allowedOrigins(config: ConfigService) {
  return (config.get<string>('FRONTEND_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(config: ConfigService, origin?: string) {
  if (!origin) return true;
  const allowed = allowedOrigins(config);
  if (!allowed.length) return process.env.NODE_ENV !== 'production';
  return allowed.includes(origin);
}

export function corsOrigin(config: ConfigService) {
  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (isAllowedOrigin(config, origin)) return callback(null, true);
    callback(new ForbiddenException('Origin is not allowed'), false);
  };
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
    const limit = isAuth ? 12 : isUpload ? 60 : 300;
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
