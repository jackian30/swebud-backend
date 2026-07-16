import { ConfigService } from '@nestjs/config';
import { RateLimitMiddleware, assertProductionConfig, bearerCorsOptions, isAllowedOrigin, websocketAllowRequest } from './security';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function productionConfig(overrides: Record<string, string | undefined> = {}) {
  return config({
    DATABASE_URL: 'postgresql://user:pass@db:5432/swebud',
    FRONTEND_ORIGIN: 'https://app.example.com',
    JWT_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    ALLOW_LOCAL_ORIGINS: 'false',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_IGNORE_TLS: 'false',
    SMTP_REQUIRE_TLS: 'true',
    SMTP_TLS_REJECT_UNAUTHORIZED: 'true',
    MAIL_FROM: 'SweBudd <no-reply@example.com>',
    CLOUDFLARE_TURNSTILE_SECRET_KEY: 'c'.repeat(40),
    ...overrides,
  });
}

describe('security helpers', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('enables credentials only behind the exact configured CORS origin callback', () => {
    const options = bearerCorsOptions(config({ FRONTEND_ORIGIN: 'https://app.example.com' }));

    expect(options.credentials).toBe(true);
    expect(options.maxAge).toBe(600);
  });

  it('allows configured origins and rejects unknown WebSocket handshake origins', () => {
    const cfg = config({ FRONTEND_ORIGIN: 'https://app.example.com', ALLOW_LOCAL_ORIGINS: 'false' });
    const allowRequest = websocketAllowRequest(cfg);
    const callback = jest.fn();

    expect(isAllowedOrigin(cfg, 'https://app.example.com')).toBe(true);
    expect(isAllowedOrigin(cfg, 'https://evil.example.com')).toBe(false);

    allowRequest({ headers: { origin: 'https://evil.example.com' } } as any, callback);

    expect(callback).toHaveBeenCalledWith('Origin is not allowed', false);
  });

  it('allows the native origin only while native authentication is enabled', () => {
    const disabled = config({
      FRONTEND_ORIGIN: 'https://app.example.com',
      NATIVE_AUTH_ENABLED: 'false',
      NATIVE_APP_ORIGIN: 'https://localhost',
      ALLOW_LOCAL_ORIGINS: 'false',
    });
    const enabled = config({
      FRONTEND_ORIGIN: 'https://app.example.com',
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
      ALLOW_LOCAL_ORIGINS: 'false',
    });

    expect(isAllowedOrigin(disabled, 'https://localhost')).toBe(false);
    expect(isAllowedOrigin(enabled, 'https://localhost')).toBe(true);
  });

  it('can explicitly allow local LAN origins for dev deployments', () => {
    process.env.NODE_ENV = 'production';
    const cfg = config({ FRONTEND_ORIGIN: 'https://app.example.com', ALLOW_LOCAL_ORIGINS: 'true' });

    expect(isAllowedOrigin(cfg, 'https://192.168.18.50:9443')).toBe(true);
  });

  it('requires distinct strong JWT secrets in production', () => {
    process.env.NODE_ENV = 'production';
    const cfg = config({
      DATABASE_URL: 'postgresql://user:pass@db:5432/swebud',
      FRONTEND_ORIGIN: 'https://app.example.com',
      JWT_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'a'.repeat(40),
    });

    expect(() => assertProductionConfig(cfg)).toThrow('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  });

  it('requires S3 media deployment env when S3 storage is selected', () => {
    process.env.NODE_ENV = 'production';
    const cfg = productionConfig({
      MEDIA_STORAGE_DRIVER: 's3',
    });

    expect(() => assertProductionConfig(cfg)).toThrow('Missing required S3 media env');
  });

  it('rejects HTTP, local-network, and path-bearing origins in production', () => {
    process.env.NODE_ENV = 'production';

    for (const origin of [
      'http://app.example.com',
      'https://localhost',
      'https://192.168.1.20:9443',
      'https://app.example.com/callback',
    ]) {
      expect(() => assertProductionConfig(productionConfig({ FRONTEND_ORIGIN: origin })))
        .toThrow('must use HTTPS in production');
    }
  });

  it('identifies an invalid optional admin origin without requiring an admin deployment', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertProductionConfig(productionConfig({ ADMIN_ORIGIN: '' }))).not.toThrow();
    expect(() => assertProductionConfig(productionConfig({ ADMIN_ORIGIN: 'https://localhost' })))
      .toThrow('ADMIN_ORIGIN=https://localhost');
  });

  it('rejects local-origin expansion in production even with a public configured origin', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertProductionConfig(productionConfig({ ALLOW_LOCAL_ORIGINS: 'true' })))
      .toThrow('ALLOW_LOCAL_ORIGINS must be false');
  });

  it('requires production SMTP identity and certificate-verified TLS', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertProductionConfig(productionConfig({ SMTP_HOST: undefined })))
      .toThrow('Missing required production env: SMTP_HOST');
    expect(() => assertProductionConfig(productionConfig({ SMTP_HOST: 'mailhog' })))
      .toThrow('production mail service');
    expect(() => assertProductionConfig(productionConfig({ SMTP_REQUIRE_TLS: 'false' })))
      .toThrow('must require TLS');
    expect(() => assertProductionConfig(productionConfig({ SMTP_TLS_REJECT_UNAUTHORIZED: 'false' })))
      .toThrow('verify TLS certificates');
    expect(() => assertProductionConfig(productionConfig({ MAIL_FROM: 'no-reply@localhost' })))
      .toThrow('verified non-localhost sender');
  });

  it('requires a non-placeholder Turnstile secret in production', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertProductionConfig(productionConfig({ CLOUDFLARE_TURNSTILE_SECRET_KEY: undefined })))
      .toThrow('Missing required production env: CLOUDFLARE_TURNSTILE_SECRET_KEY');
    expect(() => assertProductionConfig(productionConfig({ CLOUDFLARE_TURNSTILE_SECRET_KEY: 'change-me' })))
      .toThrow('CLOUDFLARE_TURNSTILE_SECRET_KEY must be set to a strong secret');
    expect(() => assertProductionConfig(productionConfig({ CLOUDFLARE_TURNSTILE_SECRET_KEY: 'too-short' })))
      .toThrow('CLOUDFLARE_TURNSTILE_SECRET_KEY must be set to a strong secret');
    expect(() => assertProductionConfig(productionConfig({ CLOUDFLARE_TURNSTILE_SECRET_KEY: 'your-turnstile-secret-key-goes-here-now' })))
      .toThrow('CLOUDFLARE_TURNSTILE_SECRET_KEY must be set to a strong secret');
  });

  it('requires an exact Capacitor origin only when native refresh transport is enabled', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertProductionConfig(productionConfig({
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: undefined,
    }))).toThrow('Missing required production env: NATIVE_APP_ORIGIN');
    expect(() => assertProductionConfig(productionConfig({
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://evil.example.com',
    }))).toThrow('exact trusted Capacitor origin');
    expect(() => assertProductionConfig(productionConfig({
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
    }))).not.toThrow();
    expect(() => assertProductionConfig(productionConfig({
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
      LEGACY_NATIVE_AUTH_COMPAT_UNTIL: 'not-a-date',
    }))).toThrow('must be a valid ISO timestamp');
  });

  it('rejects an invalid legacy web compatibility deadline', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertProductionConfig(productionConfig({
      LEGACY_WEB_AUTH_COMPAT_UNTIL: 'not-a-date',
    }))).toThrow('LEGACY_WEB_AUTH_COMPAT_UNTIL must be a valid ISO timestamp');
  });

  it('accepts a complete public HTTPS and TLS production configuration', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertProductionConfig(productionConfig())).not.toThrow();
  });

  it('prunes expired rate-limit buckets during request handling', () => {
    const middleware = new RateLimitMiddleware();
    const now = jest.spyOn(Date, 'now');

    now.mockReturnValue(0);
    middleware.use(rateLimitReq('10.0.0.1'), {} as any, jest.fn());
    expect((middleware as any).buckets.has('10.0.0.1:api')).toBe(true);

    now.mockReturnValue(60_001);
    middleware.use(rateLimitReq('10.0.0.2'), {} as any, jest.fn());

    expect((middleware as any).buckets.has('10.0.0.1:api')).toBe(false);
    expect((middleware as any).buckets.has('10.0.0.2:api')).toBe(true);
  });
});

function rateLimitReq(ip: string) {
  return { path: '/api/posts', url: '/api/posts', ip, socket: { remoteAddress: ip } } as any;
}
