import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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
    const secure = this.booleanConfig('SMTP_SECURE', port === 465 && !localHost);
    const ignoreTLS = this.booleanConfig('SMTP_IGNORE_TLS', localHost);
    const requireTLS = this.booleanConfig('SMTP_REQUIRE_TLS', false);
    const rejectUnauthorized = this.booleanConfig('SMTP_TLS_REJECT_UNAUTHORIZED', true);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const options: Record<string, unknown> = {
      host,
      port,
      secure,
      ignoreTLS,
      requireTLS,
      tls: { rejectUnauthorized },
    };
    if (user || pass) options.auth = { user, pass };
    return options;
  }

  private booleanConfig(key: string, fallback: boolean) {
    const raw = this.config.get<string>(key);
    if (raw == null || raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
  }

  async sendWelcomeEmail(input: { to: string; displayName?: string | null }) {
    const from = this.config.get<string>('MAIL_FROM') ?? 'SweBud <no-reply@localhost>';
    const name = input.displayName || input.to.split('@')[0];

    try {
      await this.transporter.sendMail({
        from,
        to: input.to,
        subject: 'Welcome to SweBud',
        text: `Hey ${name}, welcome to SweBud!`,
        html: `<p>Hey ${name}, welcome to <strong>SweBud</strong>!</p>`,
      });
    } catch (error) {
      this.logger.warn(`Welcome email failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  async sendPasswordResetEmail(input: { to: string; resetUrl: string }) {
    const from = this.config.get<string>('MAIL_FROM') ?? 'SweBud <no-reply@localhost>';

    try {
      await this.transporter.sendMail({
        from,
        to: input.to,
        subject: 'Reset your SweBud password',
        text: `Reset your SweBud password: ${input.resetUrl}`,
        html: `<p>Reset your SweBud password:</p><p><a href="${input.resetUrl}">${input.resetUrl}</a></p>`,
      });
    } catch (error) {
      this.logger.warn(`Password reset email failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
