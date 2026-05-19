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
