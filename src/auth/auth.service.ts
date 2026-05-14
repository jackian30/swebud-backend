import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ActivityPersona } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CompleteOnboardingDto, GoogleLoginDto, LoginDto, RegisterDto } from './dto';
import { TurnstileService } from './turnstile.service';
import { allowedOrigins, requiredSecret } from '../common/security';
import { activityPersonaLinkSelect, createActivityPersonaLinks, exposeActivityPersonas, replaceActivityPersonaLinks } from '../common/activity-personas';

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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
    private notifications: NotificationsService,
    private turnstile: TurnstileService,
  ) {}

  async register(dto: RegisterDto, remoteIp?: string) {
    await this.turnstile.verify(dto.captchaToken, remoteIp, 'signup');
    if (!dto.legalConsent || !dto.dataConsent) throw new BadRequestException('Legal and data consent are required');
    if (!dto.dateOfBirth) throw new BadRequestException('Birth date is required');

    const email = dto.email.toLowerCase().trim();
    const username = this.normalizeUsername(dto.username);
    if (!username) throw new BadRequestException('Username is required');
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (existing?.email === email) throw new BadRequestException('Email already registered');
    if (existing?.username === username) throw new BadRequestException('Username already taken');

    const now = new Date();
    const user = await this.prisma.user.create({
      data: {
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
      },
      select: this.safeUserSelect(),
    });

    void this.mail.sendWelcomeEmail({ to: user.email, displayName: user.displayName });
    return this.issueTokens(user);
  }

  async login(dto: LoginDto, remoteIp?: string) {
    await this.turnstile.verify(dto.captchaToken, remoteIp, 'login');
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
    const activeSessions = await this.prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } } });
    const safeUser = Object.fromEntries(Object.entries(user).filter(([key]) => key !== 'passwordHash')) as unknown as SafeUser;
    const tokens = await this.issueTokens(safeUser);
    if (activeSessions > 0) void this.notifications.create({ userId: user.id, actorId: user.id, type: 'login', message: 'New login detected on another device.' } as any);
    return tokens;
  }

  async googleLogin(dto: GoogleLoginDto) {
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
      : await this.prisma.user.create({
        data: {
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
        },
        select: this.safeUserSelect(),
      });

    return this.issueTokens(user);
  }

  async completeOnboarding(userId: string, dto: CompleteOnboardingDto) {
    if (!dto.legalConsent || !dto.dataConsent) throw new BadRequestException('Legal and data consent are required');
    const username = this.normalizeUsername(dto.username);
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
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(refreshToken, { secret: this.refreshSecret() }).catch(() => null);
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
    return this.issueTokens(user);
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
    await this.mail.sendPasswordResetEmail({ to: user.email, resetUrl: `${origin}/auth?mode=reset&token=${token}` });
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
    ]);
    return { ok: true };
  }

  async logout(userId: string, refreshToken?: string) {
    if (!refreshToken) {
      await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      return;
    }
    const storedTokens = await this.prisma.refreshToken.findMany({ where: { userId, revokedAt: null } });
    const match = await this.findMatchingToken(storedTokens, refreshToken);
    if (match) await this.prisma.refreshToken.update({ where: { id: match.id }, data: { revokedAt: new Date() } });
  }

  private async issueTokens(user: SafeUser) {
    const onboarding = this.onboardingStatus(user);
    const sessionId = randomBytes(16).toString('hex');
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, sid: sessionId, onboarded: !onboarding.requiresOnboarding }, { secret: this.accessSecret(), expiresIn: '30d' });
    const refreshToken = await this.jwt.signAsync({ sub: user.id, email: user.email, sid: sessionId, onboarded: !onboarding.requiresOnboarding }, { secret: this.refreshSecret(), expiresIn: '30d' });
    await this.prisma.refreshToken.create({
      data: { id: sessionId, userId: user.id, tokenHash: await bcrypt.hash(refreshToken, 12), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    const normalizedUser = exposeActivityPersonas(user);
    return { user: { ...normalizedUser, ...onboarding }, accessToken, refreshToken, ...onboarding };
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
    const base = this.normalizeUsername(nameBase || fallbackName).replace(/[._-]/g, '') || 'googleuser';
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
  private normalizeUsername(username?: string) { return username?.toLowerCase().replace(/^@/, '').trim().replace(/[^a-z0-9._-]/g, '') ?? ''; }
  private safeUserSelect() { return { id: true, email: true, displayName: true, username: true, usernameFinalized: true, bio: true, profileImageUrl: true, latitude: true, longitude: true, gender: true, dateOfBirth: true, activityPersonas: activityPersonaLinkSelect, legalConsentAt: true, dataConsentAt: true, googleId: true, googleEmailVerified: true } as const; }
}
