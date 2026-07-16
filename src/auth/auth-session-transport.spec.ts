import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { authTransportMode, clearWebRefreshCookie, presentAuthSession, refreshCredential, WEB_REFRESH_COOKIE } from './auth-session-transport';

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
