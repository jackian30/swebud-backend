import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TurnstileService } from './turnstile.service';

function serviceWith(config: Record<string, string | undefined>) {
  return new TurnstileService({
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService);
}

describe('TurnstileService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('does not trust a forged local Origin to bypass a production captcha', async () => {
    process.env.NODE_ENV = 'production';
    const service = serviceWith({
      CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret',
      FRONTEND_ORIGIN: 'https://swebudd.com,https://localhost',
    });

    await expect(service.verify(undefined, '203.0.113.10', 'login', 'https://localhost'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('temporarily permits a pre-Turnstile Android client only on the exact configured native origin', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-16T00:00:00.000Z'));
    const service = serviceWith({
      CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret',
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
      LEGACY_NATIVE_AUTH_COMPAT_UNTIL: '2026-10-01T00:00:00.000Z',
    });

    await expect(service.verify(undefined, '203.0.113.10', 'login', 'https://localhost', {
      legacyNativeClient: true,
    })).resolves.toEqual({
      skipped: true,
      reason: 'Legacy native captcha compatibility bridge',
    });

    await expect(service.verify(undefined, '203.0.113.10', 'login', 'https://evil.example', {
      legacyNativeClient: true,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('expires the legacy native captcha bridge at the configured instant', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00.000Z'));
    const service = serviceWith({
      CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret',
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
      LEGACY_NATIVE_AUTH_COMPAT_UNTIL: '2026-10-01T00:00:00.000Z',
    });

    await expect(service.verify(undefined, '203.0.113.10', 'login', 'https://localhost', {
      legacyNativeClient: true,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still requires captcha for production web origins', async () => {
    process.env.NODE_ENV = 'production';
    const service = serviceWith({
      CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret',
      FRONTEND_ORIGIN: 'https://swebudd.com,https://localhost',
    });

    await expect(service.verify(undefined, '203.0.113.10', 'login', 'https://swebudd.com')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed when the production Turnstile secret is missing', async () => {
    process.env.NODE_ENV = 'production';
    const service = serviceWith({});

    await expect(service.verify('token', '203.0.113.10', 'login', 'https://swebudd.com'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([undefined, 'signup'])('rejects a successful token whose action is %s instead of the expected action', async (action) => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, action }),
    } as any);
    const service = serviceWith({ CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret' });

    await expect(service.verify('token', '203.0.113.10', 'login', 'https://swebudd.com'))
      .rejects.toThrow('action mismatch');
  });

  it('accepts a successful token only when its action matches exactly', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, action: 'login', hostname: 'swebudd.com' }),
    } as any);
    const service = serviceWith({ CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret' });

    await expect(service.verify('token', '203.0.113.10', 'login', 'https://swebudd.com')).resolves.toEqual({
      skipped: false,
      hostname: 'swebudd.com',
      action: 'login',
    });
  });

  it('treats an upstream HTTP failure as a temporary verification outage', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as any);
    const service = serviceWith({ CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret' });

    await expect(service.verify('token', '203.0.113.10', 'login', 'https://swebudd.com'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
