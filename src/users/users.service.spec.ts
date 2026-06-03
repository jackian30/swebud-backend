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

describe('UsersService account deletion', () => {
  function createService() {
    const tx = {
      post: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      messageReaction: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      postEditHistory: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      commentEditHistory: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      message: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      buddySessionMessage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      buddyRoomParticipant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      buddyGroupChatMember: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      postReport: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userReport: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      groupReport: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userBadge: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { delete: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      hashtag: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'user-1', username: 'alice' }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);
    return { service, prisma, tx };
  }

  it('rejects account deletion when the username confirmation does not match', async () => {
    const { service, prisma } = createService();

    await expect(service.deleteMe('user-1', { confirmation: 'delete @wrong' }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('scrubs dangling user references before deleting the account', async () => {
    const { service, prisma, tx } = createService();

    await expect(service.deleteMe('user-1', { confirmation: 'delete @alice' })).resolves.toEqual({ ok: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.post.updateMany).toHaveBeenCalledWith({
      where: { activity: { userId: 'user-1' } },
      data: { activityId: null },
    });
    expect(tx.messageReaction.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.postEditHistory.deleteMany).toHaveBeenCalledWith({ where: { editorId: 'user-1' } });
    expect(tx.commentEditHistory.deleteMany).toHaveBeenCalledWith({ where: { editorId: 'user-1' } });
    expect(tx.message.updateMany).toHaveBeenCalledWith({ where: { deletedById: 'user-1' }, data: { deletedById: null } });
    expect(tx.buddySessionMessage.updateMany).toHaveBeenCalledWith({ where: { deletedById: 'user-1' }, data: { deletedById: null } });
    expect(tx.buddyRoomParticipant.updateMany).toHaveBeenCalledWith({ where: { kickedById: 'user-1' }, data: { kickedById: null } });
    expect(tx.buddyGroupChatMember.updateMany).toHaveBeenCalledWith({ where: { addedById: 'user-1' }, data: { addedById: null } });
    expect(tx.postReport.updateMany).toHaveBeenCalledWith({ where: { reviewedById: 'user-1' }, data: { reviewedById: null } });
    expect(tx.userReport.updateMany).toHaveBeenCalledWith({ where: { reviewedById: 'user-1' }, data: { reviewedById: null } });
    expect(tx.groupReport.updateMany).toHaveBeenCalledWith({ where: { reviewedById: 'user-1' }, data: { reviewedById: null } });
    expect(tx.userBadge.updateMany).toHaveBeenCalledWith({ where: { assignedBy: 'user-1' }, data: { assignedBy: null } });
    expect(tx.notification.deleteMany).toHaveBeenCalledWith({ where: { OR: [{ actorId: 'user-1' }, { entityId: 'user-1' }] } });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(tx.hashtag.deleteMany).toHaveBeenCalledWith({ where: { posts: { none: {} } } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });
});
