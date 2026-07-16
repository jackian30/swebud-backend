import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { booleanConfig, refreshTokenTtlSeconds } from '../common/config';

export const WEB_REFRESH_COOKIE = 'swebud.refresh';
export type AuthTransportMode = 'web' | 'native';

export function authTransportMode(req: Request, config: ConfigService): AuthTransportMode {
  const declaredNative = header(req, 'x-swebudd-client')?.toLowerCase() === 'native';
  if (!declaredNative) {
    assertWebCredentialOrigin(req, config);
    return 'web';
  }
  const enabled = booleanConfig(config, 'NATIVE_AUTH_ENABLED', false);
  const trustedOrigin = config.get<string>('NATIVE_APP_ORIGIN')?.trim();
  if (!enabled || !trustedOrigin || req.headers.origin !== trustedOrigin) {
    throw new ForbiddenException('Native authentication transport is not trusted');
  }
  return 'native';
}

export function presentAuthSession<T extends { refreshToken: string }>(
  session: T,
  mode: AuthTransportMode,
  res: Response,
  config: ConfigService,
) {
  noStore(res);
  if (mode === 'native') return session;
  res.cookie(WEB_REFRESH_COOKIE, session.refreshToken, refreshCookieOptions(config));
  const webSession = { ...session } as Partial<T>;
  delete webSession.refreshToken;
  return webSession as Omit<T, 'refreshToken'>;
}

export function refreshCredential(
  req: Request,
  providedToken: string | undefined,
  config: ConfigService,
  options: { allowMissing?: boolean } = {},
) {
  const mode = authTransportMode(req, config);
  if (mode === 'native') {
    if (!providedToken) throw new UnauthorizedException('Refresh token is required');
    return { mode, token: providedToken } as const;
  }

  if (providedToken) throw new BadRequestException('Browser refresh tokens must use the secure cookie');
  const token = cookie(req, WEB_REFRESH_COOKIE);
  if (!token && !options.allowMissing) throw new UnauthorizedException('Refresh session is missing');
  return { mode, token } as const;
}

export function clearWebRefreshCookie(res: Response, config: ConfigService) {
  noStore(res);
  res.clearCookie(WEB_REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
  void config;
}

export function assertWebCredentialOrigin(req: Request, config: ConfigService) {
  const origin = req.headers.origin;
  const allowed = frontendOrigins(config);
  if (!origin || !allowed.includes(origin)) {
    throw new ForbiddenException('Credentialed authentication requires an allowed frontend origin');
  }
}

function refreshCookieOptions(config: ConfigService) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: refreshTokenTtlSeconds(config) * 1000,
  };
}

function frontendOrigins(config: ConfigService) {
  return (config.get<string>('FRONTEND_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function cookie(req: Request, name: string) {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const entry of raw.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    const value = entry.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function header(req: Request, name: string) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}
