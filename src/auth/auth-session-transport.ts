import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { booleanConfig, refreshTokenTtlSeconds } from '../common/config';

export const WEB_REFRESH_COOKIE = 'swebud.refresh';
export const LEGACY_WEB_SESSION_MIGRATION = 'legacy-web-v1';
export type AuthTransportMode = 'web' | 'legacy-web' | 'native';

export function authTransportMode(req: Request, config: ConfigService): AuthTransportMode {
  const declaredClient = header(req, 'x-swebudd-client')?.trim().toLowerCase();
  const declaredNative = declaredClient === 'native';
  const enabled = booleanConfig(config, 'NATIVE_AUTH_ENABLED', false);
  const trustedOrigin = config.get<string>('NATIVE_APP_ORIGIN')?.trim();
  const trustedNativeOrigin = Boolean(enabled && trustedOrigin && req.headers.origin === trustedOrigin);

  if (declaredNative && !trustedNativeOrigin) {
    throw new ForbiddenException('Native authentication transport is not trusted');
  }
  if (trustedNativeOrigin && !declaredClient) {
    // Android releases through 0.2.68 identify the Capacitor runtime only by
    // its exact https://localhost Origin. Keep those installed clients able to
    // rotate their existing body refresh tokens while newer releases add the
    // X-SweBudd-Client: native declaration as defense in depth.
    return 'native';
  }
  if (trustedNativeOrigin && declaredNative) return 'native';

  assertWebCredentialOrigin(req, config);
  if (!declaredClient && legacyWebCompatibilityEnabled(req, config)) {
    // A tab that loaded the pre-cookie bundle before this deployment has no
    // client declaration and still expects rotating refresh tokens in JSON.
    // Keep that exact public origin working for a bounded rollout window;
    // current web clients always declare themselves and use the cookie path.
    return 'legacy-web';
  }
  return 'web';
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
  if (mode === 'legacy-web') return session;
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
    if (!providedToken && !options.allowMissing) throw new UnauthorizedException('Refresh token is required');
    return { mode, token: providedToken } as const;
  }

  if (mode === 'legacy-web' && providedToken) {
    return { mode, token: providedToken } as const;
  }

  if (providedToken) {
    if (header(req, 'x-swebudd-session-migration')?.toLowerCase() !== LEGACY_WEB_SESSION_MIGRATION) {
      throw new BadRequestException('Browser refresh tokens must use the secure cookie');
    }
    // This bridge consumes a refresh token that older web releases already
    // stored, rotates it, and lets presentAuthSession move the replacement into
    // the HttpOnly cookie. It never returns a browser refresh token to script.
    return { mode, token: providedToken } as const;
  }
  const token = cookie(req, WEB_REFRESH_COOKIE);
  if (!token && !options.allowMissing) throw new UnauthorizedException('Refresh session is missing');
  // A no-header tab can be classified as legacy-web during the bounded
  // compatibility window, but an ambient HttpOnly cookie is still the modern
  // browser transport. Never reflect its rotated value into JSON: only a
  // request that actually supplied a legacy body token may receive the legacy
  // response shape.
  return { mode: mode === 'legacy-web' ? 'web' : mode, token } as const;
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
  const allowed = browserCredentialOrigins(config);
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

function browserCredentialOrigins(config: ConfigService) {
  return [config.get<string>('FRONTEND_ORIGIN'), config.get<string>('ADMIN_ORIGIN')]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function legacyWebCompatibilityEnabled(req: Request, config: ConfigService) {
  const origin = req.headers.origin;
  const frontendOrigins = (config.get<string>('FRONTEND_ORIGIN') ?? '')
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  if (!origin || !frontendOrigins.includes(origin)) return false;
  const rawExpiry = config.get<string>('LEGACY_WEB_AUTH_COMPAT_UNTIL')?.trim();
  if (!rawExpiry) return false;
  const expiry = Date.parse(rawExpiry);
  return Number.isFinite(expiry) && Date.now() < expiry;
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
