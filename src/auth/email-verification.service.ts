import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { allowedOrigins } from '../common/security';
import {
  emailVerificationResendCooldownSeconds,
  emailVerificationTtlSeconds,
} from '../common/config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

const INVALID_TOKEN_MESSAGE = 'Invalid or expired verification token';
export const RESEND_VERIFICATION_MIN_RESPONSE_MS = 250;
export const RESEND_VERIFICATION_JITTER_MS = 50;
export const RESEND_VERIFICATION_RESPONSE = {
  ok: true,
  message: 'If the account exists and still needs verification, a verification email will be sent.',
} as const;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async sendForNewAccount(userId: string) {
    return this.sendForUser(userId, true);
  }

  async resend(emailInput?: string) {
    const startedAt = Date.now();
    const responseFloorMs = RESEND_VERIFICATION_MIN_RESPONSE_MS
      + randomBytes(2).readUInt16BE(0) % (RESEND_VERIFICATION_JITTER_MS + 1);
    const email = emailInput?.toLowerCase().trim();
    try {
      if (!email) return RESEND_VERIFICATION_RESPONSE;

      const user = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (user) {
        await this.sendForUser(user.id, false, email).catch((error) => {
          this.logger.warn(`Verification resend failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        });
      }
      return RESEND_VERIFICATION_RESPONSE;
    } finally {
      const remainingMs = responseFloorMs - (Date.now() - startedAt);
      if (remainingMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
      }
    }
  }

  async sendForUser(userId: string, force = false, expectedEmail?: string) {
    const now = new Date();
    const cooldownStart = new Date(
      now.getTime() - emailVerificationResendCooldownSeconds(this.config) * 1000,
    );
    const selector = randomBytes(16).toString('hex');
    const secret = randomBytes(32).toString('hex');
    const tokenHash = hashVerificationSecret(secret);
    const expiresAt = new Date(now.getTime() + emailVerificationTtlSeconds(this.config) * 1000);

    const recipient = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{
        id: string;
        email: string;
        displayName: string | null;
        emailVerifiedAt: Date | null;
      }[]>(Prisma.sql`
        SELECT
          "id",
          "email",
          "display_name" AS "displayName",
          "email_verified_at" AS "emailVerifiedAt"
        FROM "users"
        WHERE "id" = ${userId}
        FOR UPDATE
      `);
      const user = locked[0];
      if (
        !user
        || user.emailVerifiedAt
        || (expectedEmail !== undefined && user.email !== expectedEmail)
      ) {
        return null;
      }

      const claimed = await tx.user.updateMany({
        where: {
          id: user.id,
          emailVerifiedAt: null,
          ...(force
            ? {}
            : {
                OR: [
                  { emailVerificationSentAt: null },
                  { emailVerificationSentAt: { lte: cooldownStart } },
                ],
              }),
        },
        data: { emailVerificationSentAt: now },
      });
      if (claimed.count !== 1) return null;

      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.emailVerificationToken.create({
        data: {
          id: selector,
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
      return user;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (!recipient) return false;
    const token = `${selector}.${secret}`;
    void this.mail.sendEmailVerificationEmail({
        to: recipient.email,
        displayName: recipient.displayName,
        verificationUrl: this.verificationUrl(token),
      })
      .catch((error) => {
        this.logger.warn(`Verification email dispatch failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
    return true;
  }

  async verify(tokenInput: string) {
    const parsed = parseVerificationToken(tokenInput);
    if (!parsed) throw new BadRequestException(INVALID_TOKEN_MESSAGE);

    const tokenHash = hashVerificationSecret(parsed.secret);
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { id: parsed.selector },
      select: { id: true, tokenHash: true, userId: true, expiresAt: true, usedAt: true },
    });
    const now = new Date();
    if (
      !stored
      || stored.usedAt
      || stored.expiresAt <= now
      || !safeHashEquals(stored.tokenHash, tokenHash)
    ) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const lockedUser = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id"
        FROM "users"
        WHERE "id" = ${stored.userId}
        FOR UPDATE
      `);
      if (lockedUser.length !== 1) throw new BadRequestException(INVALID_TOKEN_MESSAGE);

      const claimed = await tx.emailVerificationToken.updateMany({
        where: {
          id: stored.id,
          tokenHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException(INVALID_TOKEN_MESSAGE);

      const verifiedUser = await tx.user.update({
        where: { id: stored.userId },
        data: {
          emailVerifiedAt: now,
          emailVerificationSentAt: null,
        },
        select: { id: true, email: true, displayName: true },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: stored.userId, id: { not: stored.id }, usedAt: null },
        data: { usedAt: now },
      });
      return verifiedUser;
    });

    void this.mail.sendWelcomeEmail({ to: user.email, displayName: user.displayName })
      .catch((error) => {
        this.logger.warn(`Post-verification welcome email failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
    return { ok: true, emailVerified: true } as const;
  }

  private verificationUrl(token: string) {
    const origin = allowedOrigins(this.config)[0] ?? 'http://localhost:9000';
    const url = new URL('/auth', origin);
    url.searchParams.set('mode', 'verify-email');
    url.searchParams.set('token', token);
    return url.toString();
  }
}

function parseVerificationToken(token: string) {
  const match = /^([a-f0-9]{32})\.([a-f0-9]{64})$/i.exec(token.trim());
  return match ? { selector: match[1].toLowerCase(), secret: match[2].toLowerCase() } : null;
}

function hashVerificationSecret(secret: string) {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function safeHashEquals(stored: string, candidate: string) {
  const storedBuffer = Buffer.from(stored, 'utf8');
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  return storedBuffer.length === candidateBuffer.length && timingSafeEqual(storedBuffer, candidateBuffer);
}
