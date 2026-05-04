import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoginDto, RegisterDto } from './dto';

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RESET_TTL_MS = 1000 * 60 * 30;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private config: ConfigService, private mail: MailService, private notifications: NotificationsService) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Email already registered');

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        displayName: dto.displayName?.trim(),
        theme: { create: { theme: 'system' } },
      },
      select: this.safeUserSelect(),
    });

    void this.mail.sendWelcomeEmail({ to: user.email, displayName: user.displayName });
    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const identifier = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { displayName: { equals: dto.email.trim(), mode: 'insensitive' } },
        ],
      },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
    const activeSessions = await this.prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } } });
    const tokens = await this.issueTokens({ id: user.id, email: user.email, displayName: user.displayName, bio: user.bio, latitude: user.latitude, longitude: user.longitude });
    if (activeSessions > 0) void this.notifications.create({ userId: user.id, actorId: user.id, type: 'login', message: 'New login detected on another device.' } as any);
    return tokens;
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
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: await bcrypt.hash(token, 12), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });

    const origin = this.config.get<string>('FRONTEND_ORIGIN') ?? 'http://swebud.loc';
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

  private async issueTokens(user: { id: string; email: string; displayName?: string | null; bio?: string | null; latitude?: number | null; longitude?: number | null }) {
    const sessionId = randomBytes(16).toString('hex');
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, sid: sessionId }, { secret: this.accessSecret(), expiresIn: '30d' });
    const refreshToken = await this.jwt.signAsync({ sub: user.id, email: user.email, sid: sessionId }, { secret: this.refreshSecret(), expiresIn: '30d' });
    await this.prisma.refreshToken.create({
      data: { id: sessionId, userId: user.id, tokenHash: await bcrypt.hash(refreshToken, 12), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    return { user, accessToken, refreshToken };
  }

  private async findMatchingToken<T extends { id: string; tokenHash: string }>(tokens: T[], token: string): Promise<T | null> {
    for (const stored of tokens) if (await bcrypt.compare(token, stored.tokenHash)) return stored;
    return null;
  }

  private accessSecret() { return this.config.get<string>('JWT_SECRET') ?? 'dev-secret'; }
  private refreshSecret() { return this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret'; }
  private safeUserSelect() { return { id: true, email: true, displayName: true, bio: true, latitude: true, longitude: true } as const; }
}
