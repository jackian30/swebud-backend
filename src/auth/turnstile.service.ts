import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { allowedOrigins, isLocalOrigin } from '../common/security';

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

  async verify(token?: string, remoteIp?: string, expectedAction?: string, origin?: string | null) {
    const secret = this.secretKey();
    if (!secret) {
      if (!this.canSkipMissingSecret(origin)) {
        throw new ServiceUnavailableException('Security check is not configured');
      }
      return { skipped: true, reason: 'CLOUDFLARE_TURNSTILE_SECRET_KEY is not configured' };
    }
    if (!token) {
      if (this.canSkipLocalOrNativeOrigin(origin)) {
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

  private canSkipMissingSecret(origin?: string | null) {
    if (this.canSkipLocalOrNativeOrigin(origin)) return true;
    return false;
  }

  private canSkipLocalOrNativeOrigin(origin?: string | null) {
    if (process.env.NODE_ENV !== 'production') return true;
    if (origin && isLocalOrigin(origin)) return true;
    const origins = allowedOrigins(this.config);
    return Boolean(origins.length) && origins.every((allowedOrigin) => isLocalOrigin(allowedOrigin));
  }
}
