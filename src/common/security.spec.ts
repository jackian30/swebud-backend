import { ConfigService } from '@nestjs/config';
import { RateLimitMiddleware, assertProductionConfig, bearerCorsOptions, isAllowedOrigin, websocketAllowRequest } from './security';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('security helpers', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('uses bearer-only CORS credentials', () => {
    const options = bearerCorsOptions(config({ FRONTEND_ORIGIN: 'https://app.example.com' }));

    expect(options.credentials).toBe(false);
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
    const cfg = config({
      DATABASE_URL: 'postgresql://user:pass@db:5432/swebud',
      FRONTEND_ORIGIN: 'https://app.example.com',
      JWT_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      MEDIA_STORAGE_DRIVER: 's3',
    });

    expect(() => assertProductionConfig(cfg)).toThrow('Missing required S3 media env');
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
