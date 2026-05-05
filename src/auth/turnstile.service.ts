import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type TurnstileVerifyResponse = {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
};

@Injectable()
export class TurnstileService {
  constructor(private config: ConfigService) {}

  isConfigured() {
    return Boolean(this.secretKey());
  }

  async verify(token?: string, remoteIp?: string) {
    const secret = this.secretKey();
    if (!secret) return { skipped: true, reason: 'CLOUDFLARE_TURNSTILE_SECRET_KEY is not configured' };
    if (!token) throw new BadRequestException('Captcha token is required');

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    let payload: TurnstileVerifyResponse;
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      payload = await response.json() as TurnstileVerifyResponse;
    } catch {
      throw new ServiceUnavailableException('Captcha verification is temporarily unavailable');
    }

    if (!payload.success) {
      throw new BadRequestException({ message: 'Captcha verification failed', codes: payload['error-codes'] ?? [] });
    }
    return { skipped: false, hostname: payload.hostname, action: payload.action };
  }

  private secretKey() {
    return this.config.get<string>('CLOUDFLARE_TURNSTILE_SECRET_KEY')?.trim();
  }
}
