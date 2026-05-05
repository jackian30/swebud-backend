import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectIntegrationDto, UpdateIntegrationDto } from './dto';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.externalIntegration.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { activities: true } } } });
  }

  async connect(userId: string, dto: ConnectIntegrationDto) {
    // MVP scaffold: no real OAuth exchange yet. Tokens are intentionally omitted until provider flows are wired.
    return this.prisma.externalIntegration.upsert({
      where: { userId_provider: { userId, provider: dto.provider } },
      create: { userId, provider: dto.provider, providerUserId: dto.providerUserId, scopes: dto.scopes ?? [], tokenExpiresAt: dto.tokenExpiresAt, status: 'connected' },
      update: { providerUserId: dto.providerUserId, scopes: dto.scopes ?? [], tokenExpiresAt: dto.tokenExpiresAt, status: 'connected', lastSyncError: null },
    });
  }

  oauthStart(userId: string, provider: IntegrationProvider) {
    if (!Object.values(IntegrationProvider).includes(provider)) throw new BadRequestException('Unsupported provider');
    const state = this.hash(`${userId}:${provider}:${Date.now()}`).slice(0, 32);
    return { provider, state, authorizationUrl: null, message: 'OAuth URL scaffold only. Configure client id/secret and redirect URL before enabling real provider auth.' };
  }

  update(userId: string, provider: IntegrationProvider, dto: UpdateIntegrationDto) {
    return this.prisma.externalIntegration.update({ where: { userId_provider: { userId, provider } }, data: dto });
  }

  disconnect(userId: string, provider: IntegrationProvider) {
    return this.prisma.externalIntegration.update({ where: { userId_provider: { userId, provider } }, data: { status: 'disconnected', accessTokenHash: null, refreshTokenHash: null } });
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
}
