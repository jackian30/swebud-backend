import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectIntegrationDto, UpdateIntegrationDto } from './dto';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.externalIntegration.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: this.publicSelect(),
    }).then((rows) => rows.map((row) => this.present(row)));
  }

  async connect(userId: string, dto: ConnectIntegrationDto) {
    // MVP scaffold: no real OAuth exchange yet. Tokens are intentionally omitted until provider flows are wired.
    return this.prisma.externalIntegration.upsert({
      where: { userId_provider: { userId, provider: dto.provider } },
      create: { userId, provider: dto.provider, providerUserId: dto.providerUserId, scopes: dto.scopes ?? [], tokenExpiresAt: dto.tokenExpiresAt, status: 'connected' },
      update: { providerUserId: dto.providerUserId, scopes: dto.scopes ?? [], tokenExpiresAt: dto.tokenExpiresAt, status: 'connected', lastSyncError: null },
      select: this.publicSelect(),
    }).then((row) => this.present(row));
  }

  oauthStart(userId: string, provider: IntegrationProvider) {
    this.assertProvider(provider);
    const state = this.hash(`${userId}:${provider}:${Date.now()}`).slice(0, 32);
    return { provider, state, authorizationUrl: null, message: 'OAuth URL scaffold only. Configure client id/secret and redirect URL before enabling real provider auth.' };
  }

  update(userId: string, provider: IntegrationProvider, dto: UpdateIntegrationDto) {
    this.assertProvider(provider);
    return this.prisma.externalIntegration.update({
      where: { userId_provider: { userId, provider } },
      data: dto,
      select: this.publicSelect(),
    }).then((row) => this.present(row));
  }

  disconnect(userId: string, provider: IntegrationProvider) {
    this.assertProvider(provider);
    return this.prisma.externalIntegration.update({
      where: { userId_provider: { userId, provider } },
      data: { status: 'disconnected', accessTokenHash: null, refreshTokenHash: null },
      select: this.publicSelect(),
    }).then((row) => this.present(row));
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }

  private assertProvider(provider: IntegrationProvider) {
    if (!Object.values(IntegrationProvider).includes(provider)) throw new BadRequestException('Unsupported provider');
  }

  private publicSelect() {
    return {
      id: true,
      userId: true,
      provider: true,
      providerUserId: true,
      status: true,
      tokenExpiresAt: true,
      scopes: true,
      lastSyncAt: true,
      lastSyncError: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { activities: true } },
    } as const;
  }

  private present(row: any) {
    return {
      id: row.id,
      userId: row.userId,
      provider: row.provider,
      providerUserId: row.providerUserId ?? null,
      status: row.status,
      tokenExpiresAt: row.tokenExpiresAt ?? null,
      scopes: row.scopes ?? [],
      lastSyncAt: row.lastSyncAt ?? null,
      lastSyncError: row.lastSyncError ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row._count ? { _count: row._count } : {}),
    };
  }
}
