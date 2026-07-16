import { BadRequestException } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService credential presentation', () => {
  it('uses an explicit credential-free projection and strips secrets defensively', async () => {
    const raw = {
      id: 'integration-1',
      userId: 'user-1',
      provider: IntegrationProvider.strava,
      providerUserId: 'provider-user',
      status: 'connected',
      accessTokenHash: 'must-never-leave-the-server',
      refreshTokenHash: 'must-never-leave-the-server',
      tokenExpiresAt: null,
      scopes: ['read'],
      lastSyncAt: null,
      lastSyncError: null,
      createdAt: new Date('2026-07-16T00:00:00.000Z'),
      updatedAt: new Date('2026-07-16T00:00:00.000Z'),
      _count: { activities: 2 },
    };
    const prisma = {
      externalIntegration: {
        findMany: jest.fn().mockResolvedValue([raw]),
      },
    };
    const service = new IntegrationsService(prisma as any);

    const [integration] = await service.list('user-1');

    const select = prisma.externalIntegration.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('accessTokenHash');
    expect(select).not.toHaveProperty('refreshTokenHash');
    expect(integration).not.toHaveProperty('accessTokenHash');
    expect(integration).not.toHaveProperty('refreshTokenHash');
    expect(integration).toEqual(expect.objectContaining({ id: 'integration-1', _count: { activities: 2 } }));
  });

  it('keeps connect responses credential-free even if a mocked database returns extra fields', async () => {
    const prisma = {
      externalIntegration: {
        upsert: jest.fn().mockResolvedValue({
          id: 'integration-1',
          userId: 'user-1',
          provider: IntegrationProvider.strava,
          providerUserId: null,
          status: 'connected',
          scopes: [],
          accessTokenHash: 'secret',
          refreshTokenHash: 'secret',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };
    const service = new IntegrationsService(prisma as any);

    const integration = await service.connect('user-1', { provider: IntegrationProvider.strava });

    expect(integration).not.toHaveProperty('accessTokenHash');
    expect(integration).not.toHaveProperty('refreshTokenHash');
    expect(prisma.externalIntegration.upsert.mock.calls[0][0].select).not.toHaveProperty('accessTokenHash');
  });

  it('rejects unsupported providers on every provider path before Prisma is called', async () => {
    const prisma = {
      externalIntegration: {
        update: jest.fn(),
      },
    };
    const service = new IntegrationsService(prisma as any);
    const unsupported = 'unsupported' as IntegrationProvider;

    expect(() => service.oauthStart('user-1', unsupported)).toThrow(BadRequestException);
    expect(() => service.update('user-1', unsupported, {})).toThrow(BadRequestException);
    expect(() => service.disconnect('user-1', unsupported)).toThrow(BadRequestException);
    expect(prisma.externalIntegration.update).not.toHaveBeenCalled();
  });
});
