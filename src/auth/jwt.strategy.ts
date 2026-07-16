import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { requiredSecret } from '../common/security';
import { isAccountBanned, isOnboardingComplete, moderationStateSelect, onboardingStateSelect } from './account-status';
import { refreshTokenTtlSeconds } from '../common/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private config: ConfigService, private prisma: PrismaService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: requiredSecret(config, 'JWT_SECRET', 'dev-secret') });
  }

  async validate(payload: { sub: string; sid?: string }) {
    if (!payload.sid) throw new UnauthorizedException('Session expired');
    const session = await this.prisma.refreshToken.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        loginSessionId: true,
        user: {
          select: {
            ...moderationStateSelect,
            ...onboardingStateSelect,
            banReason: true,
          },
        },
      },
    });
    if (!session) throw new UnauthorizedException('Session expired');
    if (isAccountBanned(session.user)) throw new UnauthorizedException(session.user.banReason ? `Account banned: ${session.user.banReason}` : 'Account banned');
    const expiresAt = new Date(Date.now() + refreshTokenTtlSeconds(this.config) * 1000);
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({ where: { id: session.id }, data: { expiresAt } }),
      ...(session.loginSessionId
        ? [this.prisma.loginSession.updateMany({ where: { id: session.loginSessionId, userId: payload.sub, revokedAt: null }, data: { expiresAt } })]
        : []),
    ]);
    return {
      id: payload.sub,
      sessionId: payload.sid,
      loginSessionId: session.loginSessionId,
      onboarded: isOnboardingComplete(session.user),
    };
  }
}
