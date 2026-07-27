import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import {
  isAccountBanned,
  isOnboardingComplete,
  moderationStateSelect,
  onboardingStateSelect,
} from '../auth/account-status';
import { PrismaService } from '../prisma/prisma.service';
import { assertExistingAccountMeetsAgePolicy } from './account-age';
import { requiredSecret } from './security';

export type AuthenticatedSocketAccount = {
  userId: string;
  accessTokenExpiresAtMs: number;
  emailVerified: boolean;
};

export async function authenticateSocketAccount(
  client: Socket,
  jwt: JwtService,
  config: ConfigService,
  prisma: PrismaService,
): Promise<AuthenticatedSocketAccount | null> {
  const token = client.handshake.auth?.token
    || String(client.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const payload = await jwt.verifyAsync<{ sub: string; sid?: string; exp?: number }>(token, {
    secret: requiredSecret(config, 'JWT_SECRET', 'dev-secret'),
  }).catch(() => null);
  if (!payload?.sub || !payload.sid || !Number.isFinite(payload.exp)) return null;

  const session = await prisma.refreshToken.findFirst({
    where: {
      id: payload.sid,
      userId: payload.sub,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      user: {
        select: {
          ...moderationStateSelect,
          ...onboardingStateSelect,
          emailVerifiedAt: true,
        },
      },
    },
  }).catch(() => null);
  if (!session || isAccountBanned(session.user) || !isOnboardingComplete(session.user)) return null;
  try {
    assertExistingAccountMeetsAgePolicy(session.user.dateOfBirth, config);
  } catch {
    return null;
  }
  return {
    userId: payload.sub,
    accessTokenExpiresAtMs: payload.exp! * 1000,
    emailVerified: Boolean(session.user.emailVerifiedAt),
  };
}
