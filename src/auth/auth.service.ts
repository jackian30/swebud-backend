import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { ActivityPersona, Prisma } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CompleteOnboardingDto, GoogleLoginDto, LoginDto, RegisterDto } from './dto';
import { TurnstileService } from './turnstile.service';
import { allowedOrigins, requiredSecret } from '../common/security';
import { activityPersonaLinkSelect, createActivityPersonaLinks, exposeActivityPersonas, replaceActivityPersonaLinks } from '../common/activity-personas';
import { exposeProfileBadges, profileBadgeSelect } from '../common/profile-badges';
import { normalizeUsername } from '../common/usernames';
import * as appRelease from '../common/app-version';
import { accessTokenTtlSeconds, DEFAULT_REFRESH_TOKEN_TTL_SECONDS, refreshTokenTtlSeconds } from '../common/config';
import { isAccountBanned } from './account-status';
import { EmailVerificationService } from './email-verification.service';
import { assertExistingAccountMeetsAgePolicy, assertMeetsMinimumAccountAge } from '../common/account-age';
import { minimumAccountAge } from '../common/config';

export const SESSION_TTL_MS = DEFAULT_REFRESH_TOKEN_TTL_SECONDS * 1000;
const RESET_TTL_MS = 1000 * 60 * 30;
export const PASSWORD_RESET_MIN_RESPONSE_MS = 300;
export const PASSWORD_RESET_RESPONSE_JITTER_MS = 50;

type SafeUser = {
  id: string;
  email: string;
  displayName?: string | null;
  username: string;
  usernameFinalized: boolean;
  bio?: string | null;
  profileImageUrl?: string | null;
  gender?: string | null;
  dateOfBirth?: Date | null;
  emailVerifiedAt?: Date | null;
  activityPersona?: string | null;
  activityPersonas?: Array<ActivityPersona | { persona: ActivityPersona }>;
  legalConsentAt?: Date | null;
  dataConsentAt?: Date | null;
  betaUser?: boolean | null;
  hideProfileBadges?: boolean | null;
  moderationStatus?: string | null;
  bannedAt?: Date | null;
  bannedUntil?: Date | null;
  banReason?: string | null;
  badges?: Array<{ badge: { code: string; label: string; description?: string | null; iconUrl: string; active?: boolean | null; sortOrder?: number | null } }>;
};

type GoogleTokenInfo = {
  sub: string;
  email: string;
  email_verified?: boolean | string;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  aud?: string;
};

export type SessionMetadata = {
  ipAddress?: string | null;
  userAgent?: string | null;
  origin?: string | null;
  deviceLabel?: string | null;
  locationLabel?: string | null;
  legacyNativeClient?: boolean;
};

type TokenIssueOptions = {
  metadata?: SessionMetadata;
  loginSessionId?: string | null;
  expectedPasswordHash?: string;
  expectedEmail?: string;
  expectedGoogleId?: string;
  rotateRefreshTokenId?: string;
  requireExistingLoginSession?: boolean;
};

type LockedTokenIssueUser = {
  id: string;
  passwordHash: string;
  email: string;
  googleId: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
    private notifications: NotificationsService,
    private turnstile: TurnstileService,
    private emailVerification: EmailVerificationService = null!,
  ) {}

  policy() {
    return { minimumAccountAge: minimumAccountAge(this.config) };
  }

  async register(dto: RegisterDto, metadata?: SessionMetadata) {
    await this.turnstile.verify(dto.captchaToken, metadata?.ipAddress ?? undefined, 'signup', metadata?.origin, {
      legacyNativeClient: metadata?.legacyNativeClient,
    });
    if (!dto.legalConsent || !dto.dataConsent) throw new BadRequestException('Legal and data consent are required');
    if (!dto.dateOfBirth) throw new BadRequestException('Birth date is required');
    assertMeetsMinimumAccountAge(dto.dateOfBirth, this.config);

    const email = dto.email.toLowerCase().trim();
    const username = normalizeUsername(dto.username);
    if (!username) throw new BadRequestException('Username is required');
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (existing?.email === email) throw new BadRequestException('Email already registered');
    if (existing?.username === username) throw new BadRequestException('Username already taken');

    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => tx.user.create({
      data: await this.userCreateData(tx, {
        email,
        username,
        usernameFinalized: true,
        passwordHash: await bcrypt.hash(dto.password, 12),
        displayName: dto.displayName?.trim() || null,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth,
        activityPersonas: { create: createActivityPersonaLinks(dto.activityPersonas?.length ? dto.activityPersonas : (dto.activityPersona ? [dto.activityPersona] : [])) },
        legalConsentAt: now,
        dataConsentAt: now,
        theme: { create: { theme: 'system' } },
      }),
      select: this.safeUserSelect(),
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    void this.emailVerification?.sendForNewAccount(user.id).catch((error) => {
      this.logger.warn(`Initial verification email dispatch failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
    return this.issueTokens(user, { metadata });
  }

  async login(dto: LoginDto, metadata?: SessionMetadata) {
    await this.turnstile.verify(dto.captchaToken, metadata?.ipAddress ?? undefined, 'login', metadata?.origin, {
      legacyNativeClient: metadata?.legacyNativeClient,
    });
    const identifier = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { username: identifier.replace(/^@/, '') },
        ],
      },
      select: { ...this.safeUserSelect(), passwordHash: true },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
    this.assertAccountAllowed(user);
    const activeSessions = await this.prisma.loginSession.count({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } } });
    const safeUser = Object.fromEntries(Object.entries(user).filter(([key]) => key !== 'passwordHash')) as unknown as SafeUser;
    const tokens = await this.issueTokens(safeUser, {
      metadata,
      expectedPasswordHash: user.passwordHash,
      expectedEmail: user.email,
    });
    if (activeSessions > 0) void this.notifications.create({ userId: user.id, actorId: user.id, type: 'login', message: 'New login detected on another device.' } as any);
    return tokens;
  }

  async googleLogin(dto: GoogleLoginDto, metadata?: SessionMetadata) {
    const profile = await this.verifyGoogleIdToken(dto.idToken);
    const email = profile.email.toLowerCase().trim();
    const googleEmailVerified = profile.email_verified === true || profile.email_verified === 'true';
    if (!googleEmailVerified) throw new UnauthorizedException('Google email is not verified');
    const existing = await this.prisma.user.findUnique({ where: { googleId: profile.sub }, select: this.safeUserSelect() });
    if (existing) this.assertAccountAllowed(existing);

    if (!existing) {
      const emailOwner = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (emailOwner) {
        throw new UnauthorizedException('Google sign-in is not linked to this account. Sign in with your existing method.');
      }
    }

    const user = existing
      ? await this.prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{
            id: string;
            email: string;
            googleId: string | null;
          }[]>(Prisma.sql`
            SELECT
              "id",
              "email",
              "google_id" AS "googleId"
            FROM "users"
            WHERE "id" = ${existing.id}
            FOR UPDATE
          `);
          const current = locked[0];
          if (!current || current.googleId !== profile.sub) {
            throw new UnauthorizedException('Google sign-in is no longer linked to this account');
          }
          const currentUser = await tx.user.findUnique({
            where: { id: current.id },
            select: this.safeUserSelect(),
          });
          if (!currentUser) {
            throw new UnauthorizedException('Google sign-in is no longer linked to this account');
          }
          this.assertAccountAllowed(currentUser);
          const googleEmailMatchesCurrentEmail = current.email.toLowerCase().trim() === email;
          if (!googleEmailMatchesCurrentEmail) {
            const emailOwner = await tx.user.findUnique({
              where: { email },
              select: { id: true },
            });
            if (emailOwner && emailOwner.id !== current.id) {
              throw new UnauthorizedException('Google sign-in email conflicts with another account. Use an existing sign-in method.');
            }
          }
          return tx.user.update({
            where: { id: current.id },
            data: {
              googleId: profile.sub,
              googleEmailVerified: googleEmailMatchesCurrentEmail,
              emailVerifiedAt: googleEmailMatchesCurrentEmail
                ? currentUser.emailVerifiedAt ?? new Date()
                : currentUser.emailVerifiedAt ?? null,
              verified: googleEmailMatchesCurrentEmail || undefined,
              displayName: currentUser.displayName ?? profile.name ?? null,
              profileImageUrl: profile.picture ?? undefined,
            },
            select: this.safeUserSelect(),
          });
        })
      : await this.prisma.$transaction(async (tx) => tx.user.create({
        data: await this.userCreateData(tx, {
          email,
          googleId: profile.sub,
          googleEmailVerified,
          emailVerifiedAt: googleEmailVerified ? new Date() : undefined,
          verified: googleEmailVerified,
          passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
          displayName: profile.name ?? email.split('@')[0],
          username: await this.googleDefaultUsername(profile),
          usernameFinalized: false,
          profileImageUrl: profile.picture,
          theme: { create: { theme: 'system' } },
        }),
        select: this.safeUserSelect(),
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.assertAccountAllowed(user);
    return this.issueTokens(user, {
      metadata,
      expectedEmail: user.email,
      expectedGoogleId: profile.sub,
    });
  }

  async completeOnboarding(
    userId: string,
    dto: CompleteOnboardingDto,
    metadata?: SessionMetadata,
    loginSessionId?: string | null,
    currentSessionId?: string | null,
  ) {
    if (!dto.legalConsent || !dto.dataConsent) throw new BadRequestException('Legal and data consent are required');
    assertMeetsMinimumAccountAge(dto.dateOfBirth, this.config);
    const username = normalizeUsername(dto.username);
    if (!username) throw new BadRequestException('Username is required');
    const existing = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (existing && existing.id !== userId) throw new BadRequestException('Username already taken');
    const now = new Date();
    const activityPersonas = dto.activityPersonas ?? [];
    if (!currentSessionId) throw new UnauthorizedException('Session expired');
    const user = await this.prisma.$transaction(async (tx) => {
      let updated: SafeUser;
      try {
        updated = await tx.user.update({
          where: { id: userId, dateOfBirth: null },
          data: {
            username,
            usernameFinalized: true,
            dateOfBirth: dto.dateOfBirth,
            legalConsentAt: now,
            dataConsentAt: now,
            activityPersonas: replaceActivityPersonaLinks(activityPersonas),
          },
          select: this.safeUserSelect(),
        });
      } catch (error) {
        if (this.isNotFoundError(error)) {
          throw new BadRequestException('Onboarding is already complete; contact support to correct account details');
        }
        throw error;
      }
      const revoked = await tx.refreshToken.updateMany({
        where: { id: currentSessionId, userId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) throw new UnauthorizedException('Session expired');
      return updated;
    });
    return this.issueTokens(user, {
      metadata,
      loginSessionId,
      requireExistingLoginSession: Boolean(loginSessionId),
    });
  }

  async refresh(refreshToken: string, metadata?: SessionMetadata) {
    const payload = await this.jwt.verifyAsync<{ sub: string; sid?: string; lid?: string }>(refreshToken, { secret: this.refreshSecret() }).catch(() => null);
    if (!payload) throw new UnauthorizedException('Invalid refresh token');

    const storedTokens = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() }, ...(payload as any).sid ? { id: (payload as any).sid } : {} },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const match = await this.findMatchingToken(storedTokens, refreshToken);
    if (!match) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: payload.sub },
      select: this.safeUserSelect(),
    });
    this.assertAccountAllowed(user);
    const loginSessionId = match.loginSessionId ?? payload.lid ?? null;
    return this.issueTokens(user, {
      metadata,
      loginSessionId,
      rotateRefreshTokenId: match.id,
      requireExistingLoginSession: Boolean(loginSessionId),
    });
  }

  async forgotPassword(emailInput: string) {
    const startedAt = Date.now();
    const responseFloorMs = PASSWORD_RESET_MIN_RESPONSE_MS
      + randomBytes(2).readUInt16BE(0) % (PASSWORD_RESET_RESPONSE_JITTER_MS + 1);
    const email = emailInput.toLowerCase().trim();
    try {
      const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) return { ok: true };

      const selector = randomBytes(16).toString('hex');
      const secret = randomBytes(32).toString('hex');
      const tokenHash = await bcrypt.hash(secret, 12);
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + RESET_TTL_MS);
      const recipient = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string; email: string }[]>(Prisma.sql`
          SELECT "id", "email"
          FROM "users"
          WHERE "id" = ${user.id}
          FOR UPDATE
        `);
        const current = locked[0];
        if (!current || current.email !== email) return null;

        await tx.passwordResetToken.updateMany({
          where: { userId: current.id, usedAt: null },
          data: { usedAt: issuedAt },
        });
        await tx.passwordResetToken.create({
          data: {
            id: selector,
            userId: current.id,
            tokenHash,
            expiresAt,
          },
        });
        return current;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      if (recipient) {
        const token = `${selector}.${secret}`;
        const origin = allowedOrigins(this.config)[0] ?? 'http://localhost:9000';
        void this.mail.sendPasswordResetEmail({
            to: recipient.email,
            resetUrl: `${origin}/auth?mode=reset&token=${token}`,
          })
          .catch((error) => this.logger.warn(`Password reset email dispatch failed: ${error instanceof Error ? error.message : 'unknown error'}`));
      }
      return { ok: true };
    } finally {
      const remainingMs = responseFloorMs - (Date.now() - startedAt);
      if (remainingMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
      }
    }
  }

  async resetPassword(token: string, password: string) {
    const parsed = this.parseResetToken(token);
    if (!parsed) throw new BadRequestException('Invalid or expired reset token');
    const match = await this.prisma.passwordResetToken.findUnique({ where: { id: parsed.selector } });
    if (!match || match.usedAt || match.expiresAt <= new Date() || !(await bcrypt.compare(parsed.secret, match.tokenHash))) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction(async (tx) => {
      const lockedUser = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id"
        FROM "users"
        WHERE "id" = ${match.userId}
        FOR UPDATE
      `);
      if (lockedUser.length !== 1) throw new BadRequestException('Invalid or expired reset token');

      const resetAt = new Date();
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: match.id, usedAt: null, expiresAt: { gt: resetAt } },
        data: { usedAt: resetAt },
      });
      if (claimed.count !== 1) throw new BadRequestException('Invalid or expired reset token');
      await tx.user.update({ where: { id: match.userId }, data: { passwordHash } });
      await tx.passwordResetToken.updateMany({
        where: { userId: match.userId, id: { not: match.id }, usedAt: null },
        data: { usedAt: resetAt },
      });
      await tx.refreshToken.updateMany({
        where: { userId: match.userId, revokedAt: null },
        data: { revokedAt: resetAt },
      });
      await tx.loginSession.updateMany({
        where: { userId: match.userId, revokedAt: null },
        data: { revokedAt: resetAt },
      });
    });
    return { ok: true };
  }

  verifyEmail(token: string) {
    return this.emailVerification.verify(token);
  }

  resendEmailVerification(email?: string) {
    return this.emailVerification.resend(email);
  }

  async logout(userId: string, refreshToken?: string, currentLoginSessionId?: string | null) {
    if (!refreshToken) {
      if (currentLoginSessionId) {
        await this.revokeLoginSession(userId, currentLoginSessionId);
        return;
      }
      await this.prisma.$transaction(async (tx) => {
        if (!(await this.lockUserForSessionMutation(tx, userId))) return;
        const revokedAt = new Date();
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt },
        });
        await tx.loginSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt },
        });
      });
      return;
    }
    const storedTokens = await this.prisma.refreshToken.findMany({ where: { userId, revokedAt: null } });
    const match = await this.findMatchingToken(storedTokens, refreshToken);
    if (!match) return;
    if (match.loginSessionId) await this.revokeLoginSession(userId, match.loginSessionId);
    else await this.revokeRefreshToken(userId, match.id);
  }

  private async issueTokens(user: SafeUser, options: TokenIssueOptions = {}) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedTokenIssueUser[]>(Prisma.sql`
        SELECT
          "id",
          "password_hash" AS "passwordHash",
          "email",
          "google_id" AS "googleId"
        FROM "users"
        WHERE "id" = ${user.id}
        FOR UPDATE
      `);
      const current = locked[0];
      if (!current) throw new UnauthorizedException('Account is no longer available');
      if (
        options.expectedPasswordHash !== undefined
        && current.passwordHash !== options.expectedPasswordHash
      ) {
        throw new UnauthorizedException('Account credentials changed; sign in again');
      }
      if (
        options.expectedEmail !== undefined
        && current.email !== options.expectedEmail
      ) {
        throw new UnauthorizedException('Account identity changed; sign in again');
      }
      if (
        options.expectedGoogleId !== undefined
        && current.googleId !== options.expectedGoogleId
      ) {
        throw new UnauthorizedException('Google sign-in is no longer linked to this account');
      }

      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: this.safeUserSelect(),
      });
      if (!currentUser) throw new UnauthorizedException('Account is no longer available');
      this.assertAccountAllowed(currentUser);

      const now = new Date();
      if (options.rotateRefreshTokenId) {
        const rotated = await tx.refreshToken.updateMany({
          where: {
            id: options.rotateRefreshTokenId,
            userId: currentUser.id,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });
        if (rotated.count !== 1) throw new UnauthorizedException('Invalid refresh token');
      }

      const onboarding = this.onboardingStatus(currentUser);
      const sessionId = randomBytes(16).toString('hex');
      const refreshTtl = refreshTokenTtlSeconds(this.config);
      const expiresAt = new Date(now.getTime() + refreshTtl * 1000);
      const loginSessionId = await this.ensureLoginSession(
        tx,
        currentUser.id,
        expiresAt,
        options,
        now,
      );
      const tokenPayload = {
        sub: currentUser.id,
        sid: sessionId,
        lid: loginSessionId,
        onboarded: !onboarding.requiresOnboarding,
      };
      const accessToken = await this.jwt.signAsync(tokenPayload, {
        secret: this.accessSecret(),
        expiresIn: accessTokenTtlSeconds(this.config),
      });
      const refreshToken = await this.jwt.signAsync(tokenPayload, {
        secret: this.refreshSecret(),
        expiresIn: refreshTtl,
      });
      await tx.refreshToken.create({
        data: {
          id: sessionId,
          userId: currentUser.id,
          loginSessionId,
          tokenHash: await bcrypt.hash(refreshToken, 12),
          expiresAt,
        },
      });
      return {
        user: this.presentAuthUser(currentUser, onboarding),
        accessToken,
        refreshToken,
        ...onboarding,
      };
    });
  }

  private presentAuthUser(user: SafeUser, onboarding: ReturnType<AuthService['onboardingStatus']>) {
    const normalizedUser = exposeProfileBadges(exposeActivityPersonas(user));
    return {
      id: normalizedUser.id,
      email: normalizedUser.email,
      displayName: normalizedUser.displayName,
      username: normalizedUser.username,
      usernameFinalized: normalizedUser.usernameFinalized,
      bio: normalizedUser.bio,
      profileImageUrl: normalizedUser.profileImageUrl,
      gender: normalizedUser.gender,
      dateOfBirth: normalizedUser.dateOfBirth,
      emailVerified: Boolean(normalizedUser.emailVerifiedAt),
      activityPersona: normalizedUser.activityPersona,
      activityPersonas: normalizedUser.activityPersonas,
      hideProfileBadges: normalizedUser.hideProfileBadges,
      badges: normalizedUser.badges,
      onboardingComplete: !onboarding.requiresOnboarding,
    };
  }

  private async ensureLoginSession(
    tx: Prisma.TransactionClient,
    userId: string,
    expiresAt: Date,
    options: TokenIssueOptions,
    now: Date,
  ) {
    if (options.loginSessionId) {
      const updated = await tx.loginSession.updateMany({
        where: {
          id: options.loginSessionId,
          userId,
          revokedAt: null,
          ...(options.requireExistingLoginSession ? { expiresAt: { gt: now } } : {}),
        },
        data: { expiresAt, ...sessionMetadataUpdateData(options.metadata) },
      });
      if (updated.count > 0) return options.loginSessionId;
      if (options.requireExistingLoginSession) {
        throw new UnauthorizedException('Session expired');
      }
    }

    const session = await tx.loginSession.create({
      data: {
        userId,
        expiresAt,
        ...sessionMetadataCreateData(options.metadata),
      },
      select: { id: true },
    });
    return session.id;
  }

  private async revokeLoginSession(userId: string, loginSessionId: string) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockUserForSessionMutation(tx, userId))) return;
      const revokedAt = new Date();
      await tx.loginSession.updateMany({
        where: { id: loginSessionId, userId },
        data: { revokedAt },
      });
      await tx.refreshToken.updateMany({
        where: { userId, loginSessionId, revokedAt: null },
        data: { revokedAt },
      });
    });
  }

  private async revokeRefreshToken(userId: string, refreshTokenId: string) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockUserForSessionMutation(tx, userId))) return;
      await tx.refreshToken.updateMany({
        where: { id: refreshTokenId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  private async lockUserForSessionMutation(tx: Prisma.TransactionClient, userId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "users"
      WHERE "id" = ${userId}
      FOR UPDATE
    `);
    return locked.length === 1;
  }

  private onboardingStatus(user: SafeUser) {
    const onboardingMissing = [
      !user.usernameFinalized ? 'username' : null,
      !user.dateOfBirth ? 'dateOfBirth' : null,
      !user.legalConsentAt ? 'legalConsent' : null,
      !user.dataConsentAt ? 'dataConsent' : null,
    ].filter(Boolean) as string[];
    return { requiresOnboarding: onboardingMissing.length > 0, onboardingMissing };
  }

  private assertAccountAllowed(user: SafeUser) {
    if (this.isBanned(user)) {
      throw new UnauthorizedException(user.banReason ? `Account banned: ${user.banReason}` : 'Account banned');
    }
    assertExistingAccountMeetsAgePolicy(user.dateOfBirth, this.config);
  }

  private isBanned(user: SafeUser) {
    return isAccountBanned(user);
  }

  private isNotFoundError(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: string }).code === 'P2025';
  }

  private async verifyGoogleIdToken(idToken: string): Promise<GoogleTokenInfo> {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) throw new UnauthorizedException('Invalid Google token');
    const profile = await response.json() as GoogleTokenInfo;
    if (!profile.sub || !profile.email) throw new UnauthorizedException('Invalid Google token');
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')?.trim();
    if (process.env.NODE_ENV === 'production' && !clientId) throw new UnauthorizedException('Google sign-in is not configured');
    if (clientId && profile.aud !== clientId) throw new UnauthorizedException('Google token audience mismatch');
    return profile;
  }

  private async googleDefaultUsername(profile: Pick<GoogleTokenInfo, 'email' | 'given_name' | 'family_name' | 'name'>) {
    const nameBase = [profile.given_name, profile.family_name].filter(Boolean).join('');
    const fallbackName = profile.name?.replace(/\s+/g, '') || profile.email.split('@')[0];
    const base = normalizeUsername(nameBase || fallbackName).replace(/[._-]/g, '') || 'googleuser';
    const normalizedBase = base.slice(0, 24);
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix = attempt === 0 ? '' : String(attempt + 1);
      const username = `${normalizedBase}${suffix}`.slice(0, 32);
      const existing = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
      if (!existing) return username;
    }
    return `${normalizedBase}${randomBytes(3).toString('hex')}`.slice(0, 32);
  }

  private async findMatchingToken<T extends { id: string; tokenHash: string }>(tokens: T[], token: string): Promise<T | null> {
    for (const stored of tokens) if (await bcrypt.compare(token, stored.tokenHash)) return stored;
    return null;
  }

  private parseResetToken(token: string) {
    const match = /^([a-f0-9]{32})\.([a-f0-9]{64})$/i.exec(token.trim());
    return match ? { selector: match[1].toLowerCase(), secret: match[2].toLowerCase() } : null;
  }

  private accessSecret() { return requiredSecret(this.config, 'JWT_SECRET', 'dev-secret'); }
  private refreshSecret() { return requiredSecret(this.config, 'JWT_REFRESH_SECRET', 'dev-refresh-secret'); }
  private shouldAssignBetaUser() {
    return appRelease.isBetaReleaseVersion(appRelease.appVersion());
  }
  private async userCreateData(tx: Prisma.TransactionClient, data: Prisma.UserCreateInput): Promise<Prisma.UserCreateInput> {
    void tx;
    const betaUser = this.shouldAssignBetaUser();
    return {
      ...data,
      betaUser,
      badges: betaUser ? { create: { badge: { connect: { id: 'badge_beta_user' } }, note: 'Auto-assigned during beta release' } } : undefined,
    };
  }
  private safeUserSelect() { return { id: true, email: true, displayName: true, username: true, usernameFinalized: true, bio: true, profileImageUrl: true, gender: true, dateOfBirth: true, emailVerifiedAt: true, activityPersonas: activityPersonaLinkSelect, legalConsentAt: true, dataConsentAt: true, betaUser: true, hideProfileBadges: true, moderationStatus: true, bannedAt: true, bannedUntil: true, banReason: true, badges: { select: profileBadgeSelect } } as const; }
}

export function sessionMetadataFromRequest(req: Request): SessionMetadata {
  const userAgent = firstHeader(req, 'user-agent');
  const ipAddress = firstForwardedValue(firstHeader(req, 'x-forwarded-for'))
    ?? cleanIpAddress(firstHeader(req, 'x-real-ip'))
    ?? cleanIpAddress(req.ip)
    ?? cleanIpAddress(req.socket.remoteAddress);
  const locationLabel = locationLabelFromHeaders(req);
  return {
    ipAddress,
    userAgent: cleanSessionText(userAgent, 500),
    origin: cleanSessionText(firstHeader(req, 'origin'), 160),
    deviceLabel: deviceLabelFromUserAgent(userAgent),
    locationLabel,
  };
}

function locationLabelFromHeaders(req: Request) {
  const city = decodeHeaderValue(firstHeader(req, 'cf-ipcity') ?? firstHeader(req, 'x-vercel-ip-city') ?? firstHeader(req, 'x-appengine-city'));
  const region = decodeHeaderValue(firstHeader(req, 'cf-region') ?? firstHeader(req, 'x-vercel-ip-country-region') ?? firstHeader(req, 'x-appengine-region'));
  const country = decodeHeaderValue(firstHeader(req, 'cf-ipcountry') ?? firstHeader(req, 'x-vercel-ip-country') ?? firstHeader(req, 'x-appengine-country'));
  const parts = [city, region, normalizeCountry(country)].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function deviceLabelFromUserAgent(userAgent?: string | null) {
  const value = cleanSessionText(userAgent, 500);
  if (!value) return null;
  const ua = value.toLowerCase();
  if (ua.includes('android')) return ua.includes('; wv') || ua.includes('version/4.0') ? 'Android app' : 'Android browser';
  if (/iphone|ipad|ipod/.test(ua)) return 'iOS device';
  if (ua.includes('windows')) return 'Windows browser';
  if (ua.includes('macintosh') || ua.includes('mac os x')) return 'Mac browser';
  if (ua.includes('linux')) return 'Linux browser';
  if (ua.includes('mobile')) return 'Mobile browser';
  return 'Web browser';
}

function firstHeader(req: Request, name: string) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function firstForwardedValue(value?: string | null) {
  if (!value) return null;
  return cleanIpAddress(value.split(',')[0]);
}

function cleanIpAddress(value?: string | null) {
  const cleaned = value?.trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  if (!cleaned || cleaned.toLowerCase() === 'unknown') return null;
  return cleaned.slice(0, 80);
}

function decodeHeaderValue(value?: string | null) {
  const cleaned = cleanSessionText(value, 120);
  if (!cleaned) return null;
  try {
    return decodeURIComponent(cleaned.replace(/\+/g, ' ')).trim() || null;
  } catch {
    return cleaned;
  }
}

function normalizeCountry(value?: string | null) {
  if (!value || value === 'XX') return null;
  return value;
}

function sessionMetadataCreateData(metadata?: SessionMetadata) {
  return {
    deviceLabel: cleanSessionText(metadata?.deviceLabel, 80),
    locationLabel: cleanSessionText(metadata?.locationLabel, 120),
    ipAddress: cleanSessionText(metadata?.ipAddress, 80),
    userAgent: cleanSessionText(metadata?.userAgent, 500),
  };
}

function sessionMetadataUpdateData(metadata?: SessionMetadata) {
  const data: Partial<ReturnType<typeof sessionMetadataCreateData>> = {};
  const next = sessionMetadataCreateData(metadata);
  if (next.deviceLabel) data.deviceLabel = next.deviceLabel;
  if (next.locationLabel) data.locationLabel = next.locationLabel;
  if (next.ipAddress) data.ipAddress = next.ipAddress;
  if (next.userAgent) data.userAgent = next.userAgent;
  return data;
}

function cleanSessionText(value?: string | null, maxLength = 120) {
  const cleaned = value?.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}
