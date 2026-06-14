import { BadRequestException } from '@nestjs/common';
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

  it('skips missing captcha tokens for native/local origins even when a production secret is configured', async () => {
    process.env.NODE_ENV = 'production';
    const service = serviceWith({
      CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret',
      FRONTEND_ORIGIN: 'https://swebudd.com,https://localhost',
    });

    await expect(service.verify(undefined, '203.0.113.10', 'login', 'https://localhost')).resolves.toEqual({
      skipped: true,
      reason: 'Local/native security check skipped',
    });
  });

  it('still requires captcha for production web origins', async () => {
    process.env.NODE_ENV = 'production';
    const service = serviceWith({
      CLOUDFLARE_TURNSTILE_SECRET_KEY: 'production-turnstile-secret',
      FRONTEND_ORIGIN: 'https://swebudd.com,https://localhost',
    });

    await expect(service.verify(undefined, '203.0.113.10', 'login', 'https://swebudd.com')).rejects.toBeInstanceOf(BadRequestException);
  });
});
