import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn() })),
}));

function config(values: Record<string, string | number | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('MailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps local MailHog plaintext by default', () => {
    new MailService(config({ SMTP_HOST: 'mailhog', SMTP_PORT: 1025 }));

    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'mailhog',
      port: 1025,
      secure: false,
      ignoreTLS: true,
      requireTLS: false,
      tls: { rejectUnauthorized: true },
    }));
  });

  it('uses explicit SMTP TLS and auth settings from env', () => {
    new MailService(config({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_SECURE: 'false',
      SMTP_IGNORE_TLS: 'false',
      SMTP_REQUIRE_TLS: 'true',
      SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
    }));

    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      ignoreTLS: false,
      requireTLS: true,
      tls: { rejectUnauthorized: false },
      auth: { user: 'user', pass: 'pass' },
    }));
  });
});
