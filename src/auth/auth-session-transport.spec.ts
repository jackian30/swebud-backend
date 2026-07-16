import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { authTransportMode, clearWebRefreshCookie, LEGACY_WEB_SESSION_MIGRATION, presentAuthSession, refreshCredential, WEB_REFRESH_COOKIE } from './auth-session-transport';

describe('hybrid authentication transport', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('keeps browser refresh tokens out of JSON and in a strict HttpOnly cookie', () => {
    process.env.NODE_ENV = 'production';
    const response = res();
    const result = presentAuthSession({ accessToken: 'access', refreshToken: 'refresh', user: { id: 'user-1' } }, 'web', response as any, config() as any);

    expect(result).toEqual({ accessToken: 'access', user: { id: 'user-1' } });
    expect(response.cookie).toHaveBeenCalledWith(WEB_REFRESH_COOKIE, 'refresh', expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    }));
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('keeps a pre-cookie browser bundle working only on the exact frontend origin during the rollout window', () => {
    const cfg = config({ LEGACY_WEB_AUTH_COMPAT_UNTIL: '2999-10-01T00:00:00.000Z' });
    const request = req({ origin: 'https://swebudd.com' });
    const response = res();

    expect(authTransportMode(request as any, cfg as any)).toBe('legacy-web');
    expect(refreshCredential(request as any, 'legacy-refresh', cfg as any))
      .toEqual({ mode: 'legacy-web', token: 'legacy-refresh' });
    expect(presentAuthSession(
      { accessToken: 'access', refreshToken: 'rotated-refresh' },
      'legacy-web',
      response as any,
      cfg as any,
    )).toEqual({ accessToken: 'access', refreshToken: 'rotated-refresh' });
    expect(response.cookie).toHaveBeenCalledWith(
      WEB_REFRESH_COOKIE,
      'rotated-refresh',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('never exposes an ambient HttpOnly refresh token to a no-header compatibility request', () => {
    const cfg = config({ LEGACY_WEB_AUTH_COMPAT_UNTIL: '2999-10-01T00:00:00.000Z' });
    const request = req({
      origin: 'https://swebudd.com',
      cookie: `${WEB_REFRESH_COOKIE}=cookie-refresh`,
    });
    const response = res();

    expect(authTransportMode(request as any, cfg as any)).toBe('legacy-web');
    const credential = refreshCredential(request as any, undefined, cfg as any);
    expect(credential).toEqual({ mode: 'web', token: 'cookie-refresh' });
    expect(presentAuthSession(
      { accessToken: 'access', refreshToken: 'rotated-refresh' },
      credential.mode,
      response as any,
      cfg as any,
    )).toEqual({ accessToken: 'access' });
    expect(response.cookie).toHaveBeenCalledWith(
      WEB_REFRESH_COOKIE,
      'rotated-refresh',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('keeps no-header cookie logout compatible without selecting the legacy response transport', () => {
    const cfg = config({ LEGACY_WEB_AUTH_COMPAT_UNTIL: '2999-10-01T00:00:00.000Z' });
    const request = req({
      origin: 'https://swebudd.com',
      cookie: `${WEB_REFRESH_COOKIE}=cookie-refresh`,
    });

    expect(refreshCredential(request as any, undefined, cfg as any, { allowMissing: true }))
      .toEqual({ mode: 'web', token: 'cookie-refresh' });
    expect(refreshCredential(
      req({ origin: 'https://swebudd.com' }) as any,
      undefined,
      cfg as any,
      { allowMissing: true },
    )).toEqual({ mode: 'web', token: undefined });
  });

  it('keeps explicit current web clients on cookies and closes the old body transport after expiry', () => {
    const active = config({ LEGACY_WEB_AUTH_COMPAT_UNTIL: '2999-10-01T00:00:00.000Z' });
    const expired = config({ LEGACY_WEB_AUTH_COMPAT_UNTIL: '2000-01-01T00:00:00.000Z' });

    expect(authTransportMode(req({
      origin: 'https://swebudd.com',
      'x-swebudd-client': 'web',
    }) as any, active as any)).toBe('web');
    expect(authTransportMode(req({ origin: 'https://swebudd.com' }) as any, expired as any)).toBe('web');
    expect(() => refreshCredential(
      req({ origin: 'https://swebudd.com' }) as any,
      'legacy-refresh',
      expired as any,
    )).toThrow(BadRequestException);
  });

  it('returns body refresh tokens only for the exact enabled Capacitor origin and native declaration', () => {
    const request = req({
      origin: 'https://localhost',
      'x-swebudd-client': 'native',
    });
    const cfg = config({ NATIVE_AUTH_ENABLED: 'true', NATIVE_APP_ORIGIN: 'https://localhost' });
    const response = res();

    expect(authTransportMode(request as any, cfg as any)).toBe('native');
    expect(presentAuthSession({ accessToken: 'access', refreshToken: 'native-refresh' }, 'native', response as any, cfg as any))
      .toEqual({ accessToken: 'access', refreshToken: 'native-refresh' });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('keeps pre-header Android releases compatible for the exact enabled Capacitor origin', () => {
    const request = req({ origin: 'https://localhost' });
    const cfg = config({ NATIVE_AUTH_ENABLED: 'true', NATIVE_APP_ORIGIN: 'https://localhost' });
    const response = res();

    expect(authTransportMode(request as any, cfg as any)).toBe('native');
    expect(presentAuthSession({ accessToken: 'access', refreshToken: 'legacy-refresh' }, 'native', response as any, cfg as any))
      .toEqual({ accessToken: 'access', refreshToken: 'legacy-refresh' });
    expect(refreshCredential(request as any, 'legacy-refresh', cfg as any))
      .toEqual({ mode: 'native', token: 'legacy-refresh' });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('allows legacy native logout without a refresh body while still requiring one for refresh', () => {
    const request = req({ origin: 'https://localhost' });
    const cfg = config({ NATIVE_AUTH_ENABLED: 'true', NATIVE_APP_ORIGIN: 'https://localhost' });

    expect(refreshCredential(request as any, undefined, cfg as any, { allowMissing: true }))
      .toEqual({ mode: 'native', token: undefined });
    expect(() => refreshCredential(request as any, undefined, cfg as any))
      .toThrow(UnauthorizedException);
  });

  it('does not trust the legacy Capacitor origin when native auth is disabled', () => {
    expect(() => authTransportMode(req({ origin: 'https://localhost' }) as any, config({
      NATIVE_AUTH_ENABLED: 'false',
      NATIVE_APP_ORIGIN: 'https://localhost',
    }) as any)).toThrow(ForbiddenException);
  });

  it('does not infer native transport when a client explicitly declares itself as web', () => {
    expect(() => authTransportMode(req({
      origin: 'https://localhost',
      'x-swebudd-client': 'web',
    }) as any, config({
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
    }) as any)).toThrow(ForbiddenException);
  });

  it('rejects a spoofed native header from the web origin', () => {
    expect(() => authTransportMode(req({
      origin: 'https://swebudd.com',
      'x-swebudd-client': 'native',
    }) as any, config({ NATIVE_AUTH_ENABLED: 'true', NATIVE_APP_ORIGIN: 'https://localhost' }) as any))
      .toThrow(ForbiddenException);
  });

  it('allows browser session issuance only from an exact configured frontend origin', () => {
    const cfg = config();

    expect(authTransportMode(req({ origin: 'https://swebudd.com' }) as any, cfg as any)).toBe('web');
    expect(() => authTransportMode(req() as any, cfg as any)).toThrow(ForbiddenException);
    expect(() => authTransportMode(req({ origin: 'https://swebudd.com.evil.example' }) as any, cfg as any))
      .toThrow(ForbiddenException);
  });

  it('preserves credentialed browser sessions for an explicitly configured admin origin', () => {
    const cfg = config({ ADMIN_ORIGIN: 'https://admin.swebudd.com' });

    expect(authTransportMode(req({ origin: 'https://admin.swebudd.com' }) as any, cfg as any)).toBe('web');
    expect(() => authTransportMode(req({ origin: 'https://admin.swebudd.com.evil.example' }) as any, cfg as any))
      .toThrow(ForbiddenException);
  });

  it('requires an exact allowed Origin before reading a browser cookie', () => {
    const cfg = config();

    expect(() => refreshCredential(req({ cookie: `${WEB_REFRESH_COOKIE}=secret` }) as any, undefined, cfg as any))
      .toThrow(ForbiddenException);
    expect(() => refreshCredential(req({
      origin: 'https://evil.example',
      cookie: `${WEB_REFRESH_COOKIE}=secret`,
    }) as any, undefined, cfg as any)).toThrow(ForbiddenException);
  });

  it('accepts browser cookie bootstrap, rejects body tokens, and fails closed without a cookie', () => {
    const cfg = config();
    const request = req({ origin: 'https://swebudd.com', cookie: `${WEB_REFRESH_COOKIE}=cookie-refresh` });

    expect(refreshCredential(request as any, undefined, cfg as any)).toEqual({ mode: 'web', token: 'cookie-refresh' });
    expect(() => refreshCredential(request as any, 'body-refresh', cfg as any)).toThrow(BadRequestException);
    expect(() => refreshCredential(req({ origin: 'https://swebudd.com' }) as any, undefined, cfg as any))
      .toThrow(UnauthorizedException);
  });

  it('rotates a legacy browser body token only through the one-time cookie migration bridge', () => {
    const cfg = config();
    const migrationRequest = req({
      origin: 'https://swebudd.com',
      'x-swebudd-session-migration': LEGACY_WEB_SESSION_MIGRATION,
    });

    expect(refreshCredential(migrationRequest as any, 'legacy-web-refresh', cfg as any))
      .toEqual({ mode: 'web', token: 'legacy-web-refresh' });
    expect(() => refreshCredential(req({
      origin: 'https://evil.example',
      'x-swebudd-session-migration': LEGACY_WEB_SESSION_MIGRATION,
    }) as any, 'legacy-web-refresh', cfg as any)).toThrow(ForbiddenException);
  });

  it('clears the host-only cookie with matching security attributes', () => {
    process.env.NODE_ENV = 'production';
    const response = res();

    clearWebRefreshCookie(response as any, config() as any);

    expect(response.clearCookie).toHaveBeenCalledWith(WEB_REFRESH_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
  });
});

function config(overrides: Record<string, string | undefined> = {}) {
  const values = {
    FRONTEND_ORIGIN: 'https://swebudd.com',
    REFRESH_TOKEN_TTL_SECONDS: '604800',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key as keyof typeof values]) };
}

function req(headers: Record<string, string> = {}) {
  return { headers };
}

function res() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    setHeader: jest.fn(),
  };
}
