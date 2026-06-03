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

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RESET_TTL_MS = 1000 * 60 * 30;

type SafeUser = {
  id: string;
  email: string;
  displayName?: string | null;
  username: string;
  usernameFinalized: boolean;
  bio?: string | null;
  profileImageUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gender?: string | null;
  dateOfBirth?: Date | null;
  activityPersona?: string | null;
  activityPersonas?: Array<ActivityPersona | { persona: ActivityPersona }>;
  legalConsentAt?: Date | null;
  dataConsentAt?: Date | null;
  googleId?: string | null;
  googleEmailVerified?: boolean;
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
  deviceLabel?: string | null;
  locationLabel?: string | null;
};

type TokenIssueOptions = {
  metadata?: SessionMetadata;
  loginSessionId?: string | null;
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
  ) {}

  async register(dto: RegisterDto, metadata?: SessionMetadata) {
    await this.turnstile.verify(dto.captchaToken, metadata?.ipAddress ?? undefined, 'signup');
    if (!dto.legalConsent || !dto.dataConsent) throw new BadRequestException('Legal and data consent are required');
    if (!dto.dateOfBirth) throw new BadRequestException('Birth date is required');

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

    void this.mail.sendWelcomeEmail({ to: user.email, displayName: user.displayName });
    return this.issueTokens(user, { metadata });
  }

  async login(dto: LoginDto, metadata?: SessionMetadata) {
    await this.turnstile.verify(dto.captchaToken, metadata?.ipAddress ?? undefined, 'login');
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
    const tokens = await this.issueTokens(safeUser, { metadata });
    if (activeSessions > 0) void this.notifications.create({ userId: user.id, actorId: user.id, type: 'login', message: 'New login detected on another device.' } as any);
    return tokens;
  }

  async googleLogin(dto: GoogleLoginDto, metadata?: SessionMetadata) {
    const profile = await this.verifyGoogleIdToken(dto.idToken);
    const email = profile.email.toLowerCase().trim();
    const googleEmailVerified = profile.email_verified === true || profile.email_verified === 'true';
    if (!googleEmailVerified) throw new UnauthorizedException('Google email is not verified');
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ googleId: profile.sub }, { email }] }, select: this.safeUserSelect() });

    const user = existing
      ? await this.prisma.user.update({
        where: { id: existing.id },
        data: { googleId: profile.sub, googleEmailVerified, verified: googleEmailVerified || undefined, displayName: existing.displayName ?? profile.name ?? null, profileImageUrl: profile.picture ?? undefined },
        select: this.safeUserSelect(),
      })
      : await this.prisma.$transaction(async (tx) => tx.user.create({
        data: await this.userCreateData(tx, {
          email,
          googleId: profile.sub,
          googleEmailVerified,
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
    return this.issueTokens(user, { metadata });
  }

  async completeOnboarding(userId: string, dto: CompleteOnboardingDto, metadata?: SessionMetadata, loginSessionId?: string | null) {
    if (!dto.legalConsent || !dto.dataConsent) throw new BadRequestException('Legal and data consent are required');
    const username = normalizeUsername(dto.username);
    if (!username) throw new BadRequestException('Username is required');
    const existing = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (existing && existing.id !== userId) throw new BadRequestException('Username already taken');
    const now = new Date();
    const activityPersonas = dto.activityPersonas ?? [];
    const user = await this.prisma.user.update({
      where: { id: userId },
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
    return this.issueTokens(user, { metadata, loginSessionId });
  }

  async refresh(refreshToken: string, metadata?: SessionMetadata) {
    const payload = await this.jwt.verifyAsync<{ sub: string; email: string; sid?: string; lid?: string }>(refreshToken, { secret: this.refreshSecret() }).catch(() => null);
    if (!payload) throw new UnauthorizedException('Invalid refresh token');

    const storedTokens = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() }, ...(payload as any).sid ? { id: (payload as any).sid } : {} },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const match = await this.findMatchingToken(storedTokens, refreshToken);
    if (!match) throw new UnauthorizedException('Invalid refresh token');

    await this.prisma.refreshToken.update({ where: { id: match.id }, data: { revokedAt: new Date() } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub }, select: this.safeUserSelect() });
    this.assertAccountAllowed(user);
    return this.issueTokens(user, { metadata, loginSessionId: match.loginSessionId ?? payload.lid ?? null });
  }

  async forgotPassword(emailInput: string) {
    const email = emailInput.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!user) return { ok: true };

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: await bcrypt.hash(token, 12), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });

    const origin = allowedOrigins(this.config)[0] ?? 'http://localhost:9000';
    void this.mail.sendPasswordResetEmail({ to: user.email, resetUrl: `${origin}/auth?mode=reset&token=${token}` })
      .catch((error) => this.logger.warn(`Password reset email dispatch failed: ${error instanceof Error ? error.message : 'unknown error'}`));
    return { ok: true };
  }

  async resetPassword(token: string, password: string) {
    const candidates = await this.prisma.passwordResetToken.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const match = await this.findMatchingToken(candidates, token);
    if (!match) throw new BadRequestException('Invalid or expired reset token');

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: match.userId }, data: { passwordHash: await bcrypt.hash(password, 12) } }),
      this.prisma.passwordResetToken.update({ where: { id: match.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { userId: match.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.loginSession.updateMany({ where: { userId: match.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { ok: true };
  }

  async logout(userId: string, refreshToken?: string, currentLoginSessionId?: string | null) {
    if (!refreshToken) {
      if (currentLoginSessionId) {
        await this.revokeLoginSession(userId, currentLoginSessionId);
        return;
      }
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
        this.prisma.loginSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      return;
    }
    const storedTokens = await this.prisma.refreshToken.findMany({ where: { userId, revokedAt: null } });
    const match = await this.findMatchingToken(storedTokens, refreshToken);
    if (!match) return;
    if (match.loginSessionId) await this.revokeLoginSession(userId, match.loginSessionId);
    else await this.prisma.refreshToken.update({ where: { id: match.id }, data: { revokedAt: new Date() } });
  }

  private async issueTokens(user: SafeUser, options: TokenIssueOptions = {}) {
    const onboarding = this.onboardingStatus(user);
    const sessionId = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const loginSessionId = await this.ensureLoginSession(user.id, expiresAt, options);
    const tokenPayload = { sub: user.id, email: user.email, sid: sessionId, lid: loginSessionId, onboarded: !onboarding.requiresOnboarding };
    const accessToken = await this.jwt.signAsync(tokenPayload, { secret: this.accessSecret(), expiresIn: '30d' });
    const refreshToken = await this.jwt.signAsync(tokenPayload, { secret: this.refreshSecret(), expiresIn: '30d' });
    await this.prisma.refreshToken.create({
      data: {
        id: sessionId,
        userId: user.id,
        loginSessionId,
        tokenHash: await bcrypt.hash(refreshToken, 12),
        expiresAt,
      },
    });
    const normalizedUser = exposeProfileBadges(exposeActivityPersonas(user));
    return { user: { ...normalizedUser, ...onboarding }, accessToken, refreshToken, ...onboarding };
  }

  private async ensureLoginSession(userId: string, expiresAt: Date, options: TokenIssueOptions) {
    if (options.loginSessionId) {
      const updated = await this.prisma.loginSession.updateMany({
        where: { id: options.loginSessionId, userId, revokedAt: null },
        data: { expiresAt, ...sessionMetadataUpdateData(options.metadata) },
      });
      if (updated.count > 0) return options.loginSessionId;
    }

    const session = await this.prisma.loginSession.create({
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
    const revokedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.loginSession.updateMany({ where: { id: loginSessionId, userId }, data: { revokedAt } }),
      this.prisma.refreshToken.updateMany({ where: { userId, loginSessionId, revokedAt: null }, data: { revokedAt } }),
    ]);
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
  }

  private isBanned(user: SafeUser) {
    if (user.moderationStatus !== 'banned' && !user.bannedAt) return false;
    return !user.bannedUntil || user.bannedUntil.getTime() > Date.now();
  }

  private async verifyGoogleIdToken(idToken: string): Promise<GoogleTokenInfo> {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`).catch(() => null);
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
  private safeUserSelect() { return { id: true, email: true, displayName: true, username: true, usernameFinalized: true, bio: true, profileImageUrl: true, latitude: true, longitude: true, gender: true, dateOfBirth: true, activityPersonas: activityPersonaLinkSelect, legalConsentAt: true, dataConsentAt: true, googleId: true, googleEmailVerified: true, betaUser: true, hideProfileBadges: true, moderationStatus: true, bannedAt: true, bannedUntil: true, banReason: true, badges: { select: profileBadgeSelect } } as const; }
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
