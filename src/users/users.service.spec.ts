import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserReportReason } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
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

  it('redacts post locations and raw activity data from profile responses', async () => {
    const { service, prisma } = createProfileService();
    prisma.post.findMany.mockResolvedValueOnce([{
      id: 'post-1',
      authorId: 'profile-1',
      latitude: 14.5995,
      longitude: 120.9842,
      activity: {
        id: 'activity-1',
        title: 'Morning run',
        userId: 'profile-1',
        raw: { exactRoute: [[14.5995, 120.9842]] },
      },
    }]);

    const profile = await service.profile('viewer-1', 'profile-1');

    expect(profile.posts[0]).not.toHaveProperty('latitude');
    expect(profile.posts[0]).not.toHaveProperty('longitude');
    expect(profile.posts[0].activity).toEqual({ id: 'activity-1', title: 'Morning run' });
    expect(profile.posts[0].activity).not.toHaveProperty('raw');
    expect(prisma.post.findMany.mock.calls[0][0].include.activity.select).not.toHaveProperty('raw');
  });

  it('hydrates only the profile viewer like and save state for posts and reposts', async () => {
    const { service, prisma } = createProfileService();

    await service.profile('viewer-1', 'profile-1');

    const profileSelect = prisma.user.findUniqueOrThrow.mock.calls[0][0].select;
    const repostInclude = profileSelect.reposts.include.post.include;
    const postInclude = prisma.post.findMany.mock.calls[0][0].include;
    for (const include of [repostInclude, postInclude]) {
      expect(include.likes).toEqual({ where: { userId: 'viewer-1' }, select: { userId: true } });
      expect(include.saves).toEqual({ where: { userId: 'viewer-1' }, select: { userId: true } });
    }
  });

  it('returns only a metadata-free tombstone when either user has blocked the other', async () => {
    const { service, prisma } = createProfileService();
    prisma.user.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: 'profile-1' })
      .mockResolvedValueOnce(null);
    prisma.block.findUnique
      .mockResolvedValueOnce({ blockerId: 'viewer-1' })
      .mockResolvedValueOnce(null);

    await expect(service.profile('viewer-1', 'profile-1')).resolves.toEqual({
      id: 'profile-1',
      posts: [],
      reposts: [],
      isPrivateLocked: true,
      isBlockedByMe: true,
      hasBlockedMe: false,
    });
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('uses only the safe header projection for a visibility-locked profile', async () => {
    const { service, prisma } = createProfileService();
    prisma.user.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: 'profile-1' })
      .mockResolvedValueOnce(null);
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'profile-1',
      displayName: 'Profile One',
      username: 'profileone',
      profileImageUrl: '/uploads/avatar.webp',
      verified: true,
      profileVisibility: 'private',
    });

    const profile = await service.profile('viewer-1', 'profile-1');
    const select = prisma.user.findUniqueOrThrow.mock.calls[0][0].select;

    expect(select).toEqual({
      id: true,
      displayName: true,
      username: true,
      profileImageUrl: true,
      verified: true,
      profileVisibility: true,
    });
    expect(profile).not.toHaveProperty('bio');
    expect(profile).not.toHaveProperty('_count');
    expect(profile).not.toHaveProperty('activityPersonas');
  });
});

describe('UsersService self-response privacy', () => {
  const sensitiveFields = [
    'latitude',
    'longitude',
    'theme',
    'legalConsentAt',
    'dataConsentAt',
    'googleId',
    'googleEmailVerified',
    'moderationStatus',
    'bannedAt',
    'bannedUntil',
    'banReason',
  ];

  afterEach(() => jest.restoreAllMocks());

  function sensitiveSelf() {
    return {
      id: 'user-1',
      email: 'self@example.com',
      passwordHash: 'password-hash',
      displayName: 'Self User',
      username: 'self-user',
      usernameFinalized: true,
      bio: 'Visible profile text',
      profileImageUrl: '/uploads/avatar.webp',
      coverImageUrl: '/uploads/cover.webp',
      gender: 'prefer_not_to_say',
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      activityPersonas: [{ persona: 'runner' }],
      legalConsentAt: new Date('2026-01-01T00:00:00.000Z'),
      dataConsentAt: new Date('2026-01-01T00:00:00.000Z'),
      profileVisibility: 'public',
      defaultPostVisibility: 'followers',
      betaUser: true,
      hideProfileBadges: false,
      hiddenProfileBadgeCodes: [],
      badges: [],
      verified: false,
      chatPublicKey: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      _count: { followers: 2, following: 3 },
      latitude: 14.5995,
      longitude: 120.9842,
      theme: { theme: 'dark' },
      googleId: 'google-private-id',
      googleEmailVerified: true,
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: 'internal moderation note',
    };
  }

  async function responseFor(flow: 'me' | 'update' | 'onboarding' | 'account') {
    const user = sensitiveSelf();
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue(user),
      },
    };
    const service = new UsersService(prisma, { create: jest.fn() } as any);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    let response;
    switch (flow) {
      case 'me':
        response = await service.me(user.id);
        break;
      case 'update':
        response = await service.updateMe(user.id, { bio: 'Updated profile text' });
        break;
      case 'onboarding':
        response = await service.completeOnboarding(user.id, {
          username: user.username,
          dateOfBirth: user.dateOfBirth,
          legalConsent: true,
          dataConsent: true,
        });
        break;
      case 'account':
        response = await service.updateAccount(user.id, {
          email: user.email,
          currentPassword: 'password123',
        });
        break;
    }
    const selectedQuery = flow === 'me'
      ? prisma.user.findUniqueOrThrow.mock.calls[0][0]
      : prisma.user.update.mock.calls[0][0];
    return { response, select: selectedQuery.select };
  }

  it.each(['me', 'update', 'onboarding', 'account'] as const)(
    'returns the explicit self projection from the %s flow',
    async (flow) => {
      const { response, select } = await responseFor(flow);

      expect(response).toEqual(expect.objectContaining({
        id: 'user-1',
        email: 'self@example.com',
        onboardingComplete: true,
      }));
      expect(select).not.toHaveProperty('latitude');
      expect(select).not.toHaveProperty('longitude');
      expect(select).not.toHaveProperty('theme');
      for (const field of sensitiveFields) expect(response).not.toHaveProperty(field);
    },
  );

  it('maps the legacy singular activity persona to the canonical list and supports clearing it', async () => {
    const user = sensitiveSelf();
    const prisma: any = {
      user: {
        update: jest.fn().mockResolvedValue(user),
      },
    };
    const service = new UsersService(prisma, { create: jest.fn() } as any);

    await service.updateMe(user.id, { activityPersona: 'runner' });
    expect(prisma.user.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        activityPersonas: { deleteMany: {}, create: [{ persona: 'runner', sortOrder: 0 }] },
      }),
    }));

    await service.updateMe(user.id, { activityPersona: null });
    expect(prisma.user.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        activityPersonas: { deleteMany: {}, create: [] },
      }),
    }));
  });
});

describe('UsersService discovery privacy', () => {
  it('filters non-followbacks using the validated boolean query value', async () => {
    const service = new UsersService({} as any, { create: jest.fn() } as any);
    jest.spyOn(service, 'profileFollowing').mockResolvedValue([
      { id: 'mutual-1', followsBack: true },
      { id: 'outbound-1', followsBack: false },
    ] as any);

    await expect(service.following('viewer-1', false)).resolves.toHaveLength(2);
    await expect(service.following('viewer-1', true)).resolves.toEqual([{ id: 'outbound-1', followsBack: false }]);
  });

  it('never searches private email addresses', async () => {
    const prisma = { user: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);

    await service.search('viewer-1', 'private@example.com');

    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('email');
    expect(JSON.stringify(where)).toContain('displayName');
    expect(JSON.stringify(where)).toContain('username');
  });

  it('stores authoritative profile metadata instead of client-supplied search-history labels', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'target-1', displayName: 'Real Name', username: 'realuser', profileImageUrl: '/uploads/real.webp' }) },
      userSearchHistory: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'history-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);

    await service.saveSearchHistory('viewer-1', {
      type: 'user',
      targetUserId: 'target-1',
      displayName: 'Spoofed Name',
      username: 'spoofed',
      profileImageUrl: 'https://evil.example/avatar.png',
    });

    expect(prisma.userSearchHistory.create).toHaveBeenCalledWith({
      data: {
        userId: 'viewer-1',
        type: 'user',
        targetUserId: 'target-1',
        displayName: 'Real Name',
        username: 'realuser',
        profileImageUrl: '/uploads/real.webp',
      },
      select: {
        id: true,
        type: true,
        term: true,
        targetUserId: true,
        displayName: true,
        username: true,
        profileImageUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('denies connection lists when the target profile is not visible', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'private-1' })
          .mockResolvedValueOnce(null),
      },
      follow: { findMany: jest.fn() },
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);

    await expect(service.profileFollowers('private-1', 'viewer-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.follow.findMany).not.toHaveBeenCalled();
  });

  it('returns both public participants for incoming and sent follow requests', async () => {
    const row = {
      id: 'request-1',
      requesterId: 'requester-1',
      recipientId: 'recipient-1',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      requester: { id: 'requester-1', activityPersonas: [], badges: [] },
      recipient: { id: 'recipient-1', activityPersonas: [], badges: [] },
    };
    const prisma = { followRequest: { findMany: jest.fn().mockResolvedValue([row]) } };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);

    await expect(service.incomingFollowRequests('recipient-1')).resolves.toEqual([expect.objectContaining({
      requester: expect.objectContaining({ id: 'requester-1' }),
      recipient: expect.objectContaining({ id: 'recipient-1' }),
    })]);
    await service.sentFollowRequests('requester-1');

    for (const call of prisma.followRequest.findMany.mock.calls) {
      expect(call[0].include).toEqual(expect.objectContaining({ requester: expect.any(Object), recipient: expect.any(Object) }));
    }
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

describe('UsersService blocking', () => {
  it('creates the block and removes both users social grants atomically', async () => {
    const tx = {
      block: { upsert: jest.fn() },
      follow: { deleteMany: jest.fn() },
      followRequest: { deleteMany: jest.fn() },
      messageRequest: { deleteMany: jest.fn() },
      closeBuddy: { deleteMany: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'peer-1' }) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);

    await expect(service.block('user-1', '@peer')).resolves.toEqual({ blocked: true });

    expect(tx.block.upsert).toHaveBeenCalledWith({
      where: { blockerId_blockedId: { blockerId: 'user-1', blockedId: 'peer-1' } },
      create: { blockerId: 'user-1', blockedId: 'peer-1' },
      update: {},
    });
    expect(tx.closeBuddy.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { ownerId: 'user-1', buddyId: 'peer-1' },
          { ownerId: 'peer-1', buddyId: 'user-1' },
        ],
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('UsersService account sessions', () => {
  it('returns login sessions with current and active flags', async () => {
    const now = Date.now();
    jest.useFakeTimers().setSystemTime(new Date(now));
    const prisma = {
      loginSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'login-session-current',
            createdAt: new Date(now - 1000),
            expiresAt: new Date(now + 1000),
            revokedAt: null,
            deviceLabel: 'Android app',
            locationLabel: 'Makati, PH',
            ipAddress: '203.0.113.10',
            userAgent: 'Android WebView',
          },
          {
            id: 'login-session-revoked',
            createdAt: new Date(now - 2000),
            expiresAt: new Date(now + 1000),
            revokedAt: new Date(now - 500),
            deviceLabel: 'Web browser',
            locationLabel: null,
            ipAddress: null,
            userAgent: null,
          },
        ]),
      },
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);

    await expect(service.sessions('user-1', 'login-session-current')).resolves.toEqual([
      expect.objectContaining({ id: 'login-session-current', current: true, active: true, locationLabel: 'Makati, PH' }),
      expect.objectContaining({ id: 'login-session-revoked', current: false, active: false }),
    ]);

    expect(prisma.loginSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      take: 50,
    }));
    jest.useRealTimers();
  });

  it('revokes the visible login session and linked refresh tokens together', async () => {
    const prisma = {
      loginSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations)),
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);

    await expect(service.revokeSession('user-1', 'login-session-1')).resolves.toEqual({ ok: true });

    expect(prisma.loginSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'login-session-1', userId: 'user-1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { loginSessionId: 'login-session-1', userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe('UsersService mutual-follow message request transition', () => {
  it('accepts a pending message request once under concurrent follow transitions', async () => {
    let pending = true;
    const tx = {
      follow: {
        count: jest.fn().mockResolvedValue(2),
      },
      block: { findFirst: jest.fn().mockResolvedValue(null) },
      messageRequest: {
        updateMany: jest.fn().mockImplementation(async () => {
          if (!pending) return { count: 0 };
          pending = false;
          return { count: 1 };
        }),
      },
      message: { create: jest.fn().mockResolvedValue({ id: 'message-1' }) },
    };
    const request = {
      id: 'request-1',
      senderId: 'peer-1',
      recipientId: 'user-1',
      body: 'hello',
      referenceType: null,
      referenceId: null,
      referenceMediaUrl: null,
      referenceText: null,
      referenceAuthorName: null,
    };
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'peer-1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'peer-1',
          profileVisibility: 'public',
          blocksSent: [],
          blocksReceived: [],
        }),
      },
      follow: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ followerId: 'user-1', followingId: 'peer-1' }),
      },
      followRequest: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      messageRequest: { findMany: jest.fn().mockResolvedValue([request]) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new UsersService(prisma as any, { create: jest.fn() } as any);

    await Promise.all([
      service.follow('user-1', 'peer-1'),
      service.follow('user-1', 'peer-1'),
    ]);

    expect(tx.messageRequest.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.message.create).toHaveBeenCalledTimes(1);
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
