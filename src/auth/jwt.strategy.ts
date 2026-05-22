import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TTL_MS } from './auth.service';
import { requiredSecret } from '../common/security';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: requiredSecret(config, 'JWT_SECRET', 'dev-secret') });
  }

  async validate(payload: { sub: string; email: string; sid?: string }) {
    if (!payload.sid) throw new UnauthorizedException('Session expired');
    const session = await this.prisma.refreshToken.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, user: { select: { moderationStatus: true, bannedAt: true, bannedUntil: true, banReason: true } } },
    });
    if (!session) throw new UnauthorizedException('Session expired');
    const banned = (session.user.moderationStatus === 'banned' || session.user.bannedAt)
      && (!session.user.bannedUntil || session.user.bannedUntil.getTime() > Date.now());
    if (banned) throw new UnauthorizedException(session.user.banReason ? `Account banned: ${session.user.banReason}` : 'Account banned');
    await this.prisma.refreshToken.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    return { id: payload.sub, email: payload.email, sessionId: payload.sid };
  }
}
