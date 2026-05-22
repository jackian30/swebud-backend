import { BadRequestException } from '@nestjs/common';
import { UserReportReason } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService profile privacy', () => {
  function createProfileService() {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'profile-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'profile-1',
          displayName: 'Profile One',
          username: 'profileone',
          posts: [],
          reposts: [],
        }),
      },
      follow: { findUnique: jest.fn().mockResolvedValue(null) },
      closeBuddy: { findUnique: jest.fn().mockResolvedValue(null) },
      followRequest: { findUnique: jest.fn().mockResolvedValue(null) },
      block: { findUnique: jest.fn().mockResolvedValue(null) },
      post: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);
    return { service, prisma };
  }

  it('uses the public user projection for visible profile pages', async () => {
    const { service, prisma } = createProfileService();

    const profile = await service.profile('viewer-1', 'profile-1');

    const profileSelect = prisma.user.findUniqueOrThrow.mock.calls[0][0].select;
    expect(profileSelect).not.toHaveProperty('email');
    expect(profileSelect).not.toHaveProperty('dateOfBirth');
    expect(profileSelect).not.toHaveProperty('gender');
    expect(profileSelect).not.toHaveProperty('defaultPostVisibility');
    expect(profileSelect).not.toHaveProperty('latitude');
    expect(profileSelect).not.toHaveProperty('longitude');
    expect(profile).not.toHaveProperty('email');
    expect(profile).not.toHaveProperty('dateOfBirth');
    expect(profile).not.toHaveProperty('gender');
    expect(profile).not.toHaveProperty('defaultPostVisibility');
    expect(profile).not.toHaveProperty('latitude');
    expect(profile).not.toHaveProperty('longitude');
  });
});

describe('UsersService profile reports', () => {
  function createService() {
    const prisma = {
      user: {
        findFirst: jest.fn(),
      },
      userReport: {
        upsert: jest.fn().mockResolvedValue({ id: 'report-1' }),
      },
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);
    return { service, prisma };
  }

  it('creates a report against the resolved profile user', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue({ id: 'reported-1' });

    await expect(service.report('reporter-1', '@reported', {
      reason: UserReportReason.harassment,
      note: '  abusive messages  ',
    })).resolves.toEqual({ ok: true });

    expect(prisma.userReport.upsert).toHaveBeenCalledWith({
      where: { reportedId_reporterId: { reportedId: 'reported-1', reporterId: 'reporter-1' } },
      create: {
        reportedId: 'reported-1',
        reporterId: 'reporter-1',
        reason: UserReportReason.harassment,
        category: 'harassment',
        note: 'abusive messages',
        details: null,
        status: 'open',
      },
      update: {
        reason: UserReportReason.harassment,
        category: 'harassment',
        note: 'abusive messages',
        details: null,
        status: 'open',
        reviewedAt: null,
        reviewedById: null,
        actionTaken: null,
        resolutionNote: null,
      },
    });
  });

  it('rejects reporting yourself', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue({ id: 'reporter-1' });

    await expect(service.report('reporter-1', 'reporter-1', { reason: UserReportReason.other }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
