import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST') ?? 'mailhog',
      port: this.config.get<number>('SMTP_PORT') ?? 1025,
      secure: false,
      ignoreTLS: true,
    });
  }

  async sendWelcomeEmail(input: { to: string; displayName?: string | null }) {
    const from = this.config.get<string>('MAIL_FROM') ?? 'SweBud <no-reply@swebud.local>';
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
    const from = this.config.get<string>('MAIL_FROM') ?? 'SweBud <no-reply@swebud.loc>';

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
