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

  async verify(token?: string, remoteIp?: string, expectedAction?: string, _origin?: string | null) {
    const secret = this.secretKey();
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('Security check is not configured');
      }
      return { skipped: true, reason: 'CLOUDFLARE_TURNSTILE_SECRET_KEY is not configured' };
    }
    if (!token) {
      if (process.env.NODE_ENV !== 'production') {
        return { skipped: true, reason: 'Local/native security check skipped' };
      }
      throw new BadRequestException('Please complete the security check before continuing.');
    }

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    let payload: TurnstileVerifyResponse;
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Turnstile returned a non-success status');
      payload = await response.json() as TurnstileVerifyResponse;
    } catch {
      throw new ServiceUnavailableException('Captcha verification is temporarily unavailable');
    }

    if (!payload.success) {
      throw new BadRequestException({ message: 'Security check failed. Please try again.', codes: payload['error-codes'] ?? [] });
    }
    if (expectedAction && payload.action !== expectedAction) {
      throw new BadRequestException('Security check action mismatch. Please try again.');
    }
    return { skipped: false, hostname: payload.hostname, action: payload.action };
  }

  private secretKey() {
    const value = this.config.get<string>('CLOUDFLARE_TURNSTILE_SECRET_KEY')?.trim();
    return value && value !== '***' ? value : '';
  }

}
