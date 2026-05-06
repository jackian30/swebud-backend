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

  async verify(token?: string, remoteIp?: string, expectedAction?: string) {
    const secret = this.secretKey();
    if (!secret) {
      if (!this.canSkipMissingSecret()) {
        throw new ServiceUnavailableException('Security check is not configured');
      }
      return { skipped: true, reason: 'CLOUDFLARE_TURNSTILE_SECRET_KEY is not configured' };
    }
    if (!token) {
      if (this.canSkipLocalDev()) {
        return { skipped: true, reason: 'Local dev security check skipped' };
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
      });
      payload = await response.json() as TurnstileVerifyResponse;
    } catch {
      throw new ServiceUnavailableException('Captcha verification is temporarily unavailable');
    }

    if (!payload.success) {
      throw new BadRequestException({ message: 'Security check failed. Please try again.', codes: payload['error-codes'] ?? [] });
    }
    if (expectedAction && payload.action && payload.action !== expectedAction) {
      throw new BadRequestException('Security check action mismatch. Please try again.');
    }
    return { skipped: false, hostname: payload.hostname, action: payload.action };
  }

  private secretKey() {
    const value = this.config.get<string>('CLOUDFLARE_TURNSTILE_SECRET_KEY')?.trim();
    return value && value !== '***' ? value : '';
  }

  private canSkipMissingSecret() {
    if (this.canSkipLocalDev()) return true;
    return false;
  }

  private canSkipLocalDev() {
    if (process.env.NODE_ENV !== 'production') return true;
    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN')?.trim() ?? '';
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(frontendOrigin);
  }
}
