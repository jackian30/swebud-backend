import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { booleanConfig } from '../common/config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport(this.smtpOptions());
  }

  private smtpOptions() {
    const host = this.config.get<string>('SMTP_HOST') ?? 'mailhog';
    const port = Number(this.config.get<string | number>('SMTP_PORT') ?? 1025);
    const localHost = ['mailhog', 'localhost', '127.0.0.1'].includes(host.toLowerCase());
    const secure = booleanConfig(this.config, 'SMTP_SECURE', port === 465 && !localHost);
    const ignoreTLS = booleanConfig(this.config, 'SMTP_IGNORE_TLS', localHost);
    const requireTLS = booleanConfig(this.config, 'SMTP_REQUIRE_TLS', false);
    const rejectUnauthorized = booleanConfig(this.config, 'SMTP_TLS_REJECT_UNAUTHORIZED', true);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const connectionTimeout = this.numericConfig('SMTP_CONNECTION_TIMEOUT_MS', 10_000);
    const greetingTimeout = this.numericConfig('SMTP_GREETING_TIMEOUT_MS', 10_000);
    const socketTimeout = this.numericConfig('SMTP_SOCKET_TIMEOUT_MS', 20_000);
    const family = this.ipFamilyConfig('SMTP_IP_FAMILY', 4);
    const options: Record<string, unknown> = {
      host,
      port,
      secure,
      ignoreTLS,
      requireTLS,
      connectionTimeout,
      greetingTimeout,
      socketTimeout,
      tls: { rejectUnauthorized },
    };
    if (family != null) options.family = family;
    if (user || pass) options.auth = { user, pass };
    return options;
  }

  private numericConfig(key: string, fallback: number) {
    const raw = this.config.get<string | number>(key);
    if (raw == null || raw === '') return fallback;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private ipFamilyConfig(key: string, fallback: 4 | 6) {
    const raw = this.config.get<string | number>(key);
    if (raw == null || raw === '') return fallback;
    if (raw === 4 || raw === '4') return 4;
    if (raw === 6 || raw === '6') return 6;
    if (String(raw).toLowerCase() === 'auto' || raw === 0 || raw === '0') return null;
    return fallback;
  }

  async sendWelcomeEmail(input: { to: string; displayName?: string | null }) {
    const from = this.config.get<string>('MAIL_FROM') ?? 'SweBudd <no-reply@localhost>';
    const name = input.displayName || input.to.split('@')[0];

    try {
      await this.transporter.sendMail({
        from,
        to: input.to,
        subject: 'Welcome to SweBudd',
        text: `Hey ${name}, welcome to SweBudd!`,
        html: `<p>Hey ${name}, welcome to <strong>SweBudd</strong>!</p>`,
      });
    } catch (error) {
      this.logger.warn(`Welcome email failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  async sendPasswordResetEmail(input: { to: string; resetUrl: string }) {
    const from = this.config.get<string>('MAIL_FROM') ?? 'SweBudd <no-reply@localhost>';

    try {
      await this.transporter.sendMail({
        from,
        to: input.to,
        subject: 'Reset your SweBudd password',
        text: `Reset your SweBudd password: ${input.resetUrl}`,
        html: `<p>Reset your SweBudd password:</p><p><a href="${input.resetUrl}">${input.resetUrl}</a></p>`,
      });
    } catch (error) {
      this.logger.warn(`Password reset email failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
