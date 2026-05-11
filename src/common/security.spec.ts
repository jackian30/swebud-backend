import { ConfigService } from '@nestjs/config';
import { assertProductionConfig, bearerCorsOptions, isAllowedOrigin, websocketAllowRequest } from './security';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('security helpers', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('uses bearer-only CORS credentials', () => {
    const options = bearerCorsOptions(config({ FRONTEND_ORIGIN: 'https://app.example.com' }));

    expect(options.credentials).toBe(false);
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
});
