import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GroupsService } from './groups.service';

describe('GroupsService', () => {
  const userId = 'user-1';
  const groupId = 'group-1';
  let prisma: any;
  let notifications: any;
  let service: GroupsService;

  beforeEach(() => {
    prisma = {
      groupMember: {
        findUnique: jest.fn().mockResolvedValue({ userId, groupId, role: 'member' }),
        findUniqueOrThrow: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((input) => typeof input === 'function' ? input(prisma) : Promise.all(input)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      group: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ allowAnonymousPosts: true }),
        update: jest.fn(),
      },
      groupInvite: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notification: {
        updateMany: jest.fn(),
      },
      groupChatMute: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      groupChatChannelMute: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      groupChatChannel: {
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      post: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'post-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    notifications = { create: jest.fn() };
    service = new GroupsService(prisma, notifications);
  });

  it('rejects group posts without text or media', async () => {
    await expect(service.createPost(userId, groupId, { text: '   ', images: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('clamps group-post cursors and page sizes to safe values', async () => {
    await service.posts(userId, groupId, { take: -10, cursor: -5 });

    expect(prisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 1 }));
  });

  it('rejects group names that are empty after trimming', async () => {
    await expect(service.create(userId, { name: '   ', slug: 'valid-group' }))
      .rejects.toBeInstanceOf(BadRequestException);

    prisma.groupMember.findUnique.mockResolvedValueOnce({ role: 'admin' });
    await expect(service.updateSettings(userId, groupId, { name: '   ' }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.group.create).not.toHaveBeenCalled();
    expect(prisma.group.update).not.toHaveBeenCalled();
  });

  it('allows admins to update ordinary member and moderator roles', async () => {
    prisma.groupMember.findUnique.mockResolvedValueOnce({ role: 'admin' });
    prisma.groupMember.findUniqueOrThrow.mockResolvedValueOnce({ role: 'member' });
    prisma.group.findUniqueOrThrow.mockResolvedValueOnce({ id: groupId, members: [] });

    await service.updateRole(userId, groupId, 'member-1', 'moderator');

    expect(prisma.groupMember.update).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId, userId: 'member-1' } },
      data: { role: 'moderator' },
    });
  });

  it('reserves assigning and changing owner or admin roles for owners', async () => {
    prisma.groupMember.findUnique.mockResolvedValueOnce({ role: 'admin' });
    prisma.groupMember.findUniqueOrThrow.mockResolvedValueOnce({ role: 'admin' });

    await expect(service.updateRole(userId, groupId, 'admin-2', 'member'))
      .rejects.toThrow('Only owners');

    expect(prisma.groupMember.update).not.toHaveBeenCalled();
  });

  it('accepts a group invite exactly once through an atomic pending-state claim', async () => {
    prisma.groupInvite.findFirst.mockResolvedValueOnce({
      id: 'invite-1',
      groupId,
      inviterId: 'inviter-1',
      inviteeId: userId,
      status: 'pending',
      group: { id: groupId, name: 'Morning Runners', slug: 'morning-runners' },
    });
    jest.spyOn(service, 'get').mockResolvedValue({ id: groupId, slug: 'morning-runners' } as any);

    await service.acceptInvite(userId, 'invite-1');

    expect(prisma.groupInvite.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-1', inviteeId: userId, status: 'pending' },
      data: { status: 'accepted', respondedAt: expect.any(Date) },
    });
    expect(prisma.groupMember.upsert).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('does not add membership or notify when a concurrent invite acceptance loses the claim', async () => {
    prisma.groupInvite.findFirst.mockResolvedValueOnce({
      id: 'invite-1',
      groupId,
      inviterId: 'inviter-1',
      inviteeId: userId,
      status: 'pending',
      group: { id: groupId, name: 'Morning Runners', slug: 'morning-runners' },
    });
    prisma.groupInvite.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.acceptInvite(userId, 'invite-1')).rejects.toThrow('no longer available');

    expect(prisma.groupMember.upsert).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('persists group post media metadata in sort order', async () => {
    await service.createPost(userId, groupId, {
      text: 'Group lift',
      images: [
        { url: '/api/uploads/posts/one.webp', mediaType: 'image', mimeType: 'image/webp', filename: 'one.webp', width: 100, height: 90 },
        { url: '/api/uploads/posts/two.mp4', type: 'video', mimeType: 'video/mp4', filename: 'two.mp4', size: 1200 },
      ],
    });

    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        groupId,
        authorId: userId,
        text: 'Group lift',
        images: {
          create: [
            expect.objectContaining({ url: '/api/uploads/posts/one.webp', mediaType: 'image', sortOrder: 0 }),
            expect.objectContaining({ url: '/api/uploads/posts/two.mp4', mediaType: 'video', sortOrder: 1 }),
          ],
        },
      }),
    }));
  });

  it('includes repost count in group post responses', async () => {
    prisma.post.create.mockResolvedValueOnce({
      id: 'post-1',
      groupId,
      authorId: userId,
      text: 'Group lift',
      _count: { reposts: 2 },
    });

    const post = await service.createPost(userId, groupId, { text: 'Group lift' });

    expect(post).toEqual(expect.objectContaining({ repostCount: 2 }));
    expect(post).not.toHaveProperty('_count');
    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        _count: { select: { reposts: true } },
      }),
    }));
  });

  it('returns the latest group message for chat list previews', async () => {
    prisma.group.findMany.mockResolvedValueOnce([
      {
        id: groupId,
        name: 'Morning Runners',
        members: [{ userId, role: 'member' }],
        messages: [
          {
            id: 'message-1',
            groupId,
            channelId: 'channel-1',
            senderId: 'user-2',
            body: 'See you at 6',
            createdAt: new Date('2026-05-07T09:00:00Z'),
            sender: { id: 'user-2', displayName: 'Peer', username: 'peer', profileImageUrl: null },
          },
        ],
      },
    ]);

    const groups = await service.mine(userId);

    expect(groups[0]).toEqual(expect.objectContaining({
      id: groupId,
      lastMessage: expect.objectContaining({ id: 'message-1', body: 'See you at 6' }),
    }));
    expect(groups[0]).not.toHaveProperty('messages');
    expect(prisma.group.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        messages: expect.objectContaining({
          take: 1,
          orderBy: { createdAt: 'desc' },
        }),
      }),
    }));
  });

  it('returns a lean group summary for buddy session pages', async () => {
    prisma.group.findUniqueOrThrow.mockResolvedValueOnce({
      id: groupId,
      name: 'Morning Runners',
      slug: 'morning-runners',
      visibility: 'public',
      profileImageUrl: null,
      members: [{ userId, role: 'member' }],
      _count: { members: 4, messages: 0, posts: 0, chatChannels: 1 },
    });

    const group = await service.get(userId, 'morning-runners', { summaryOnly: true });

    expect(group).toEqual(expect.objectContaining({
      id: groupId,
      name: 'Morning Runners',
      slug: 'morning-runners',
      isMember: true,
    }));
    expect(group).not.toHaveProperty('members');
    expect(group).not.toHaveProperty('posts');
    expect(group).not.toHaveProperty('chatChannels');
    expect(prisma.group.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        members: expect.objectContaining({
          where: { userId },
          take: 1,
        }),
      }),
    }));
  });

  it('rejects direct joins to private groups without an explicit invite grant', async () => {
    prisma.group.findUniqueOrThrow.mockResolvedValueOnce({
      slug: 'private-club',
      visibility: 'private',
      members: [],
    });

    await expect(service.join(userId, groupId)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.groupMember.upsert).not.toHaveBeenCalled();
  });

  it('allows an invite code to grant private-group membership', async () => {
    prisma.group.findUniqueOrThrow.mockResolvedValueOnce({ id: groupId, slug: 'private-club' });
    jest.spyOn(service, 'get').mockResolvedValue({ id: groupId, slug: 'private-club' } as any);

    await service.joinByInvite(userId, 'valid-code');

    expect(prisma.groupMember.upsert).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId },
      update: {},
    });
  });

  it('does not fall back to a private default channel the member cannot access', async () => {
    prisma.groupChatChannel.findMany.mockResolvedValueOnce([{
      id: 'private-channel-1',
      groupId,
      name: 'staff',
      visibility: 'private',
      allowedUsers: [],
      createdAt: new Date(),
    }]);
    prisma.groupMember.findUnique.mockResolvedValue({ role: 'member' });

    await expect(service.messages(userId, groupId)).rejects.toThrow('No accessible group channel');
  });

  it('keeps channel and message GET paths free of repair/read-receipt writes', async () => {
    prisma.groupChatChannel.findMany.mockResolvedValue([{
      id: 'channel-1',
      groupId,
      name: 'main',
      visibility: 'public',
      messagePolicy: 'everyone',
      allowedUsers: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }]);
    prisma.message = {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    };
    prisma.groupChatReadState = { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
    prisma.groupChatChannel.create = jest.fn();
    prisma.groupChatChannel.update = jest.fn();

    await service.channels(userId, groupId);
    await service.messages(userId, groupId);

    expect(prisma.groupChatChannel.create).not.toHaveBeenCalled();
    expect(prisma.groupChatChannel.update).not.toHaveBeenCalled();
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
    expect(prisma.groupChatReadState.upsert).not.toHaveBeenCalled();
  });

  it('filters inaccessible private channels and anonymizes embedded group posts', () => {
    const group = (service as any).presentGroup({
      id: groupId,
      members: [{ userId, role: 'member' }],
      chatChannels: [
        { id: 'main', visibility: 'public', allowedUsers: [] },
        { id: 'staff', visibility: 'private', allowedUsers: [{ userId: 'admin-1' }] },
      ],
      messages: [
        { id: 'private-message', channelId: 'staff', body: 'secret' },
        {
          id: 'public-message',
          channelId: 'main',
          body: 'hello',
          reactions: [{ id: 'reaction-1', messageId: 'public-message', userId, emoji: '🔥', createdAt: new Date() }],
        },
      ],
      posts: [{ id: 'anonymous-post', authorId: 'secret-author', isAnonymous: true, author: { id: 'secret-author' } }],
    }, userId);

    expect(group.chatChannels.map((channel: any) => channel.id)).toEqual(['main']);
    expect(group.messages).toEqual([expect.objectContaining({
      id: 'public-message',
      reactions: [{ userId, emoji: '🔥' }],
    })]);
    expect(group.posts[0]).not.toHaveProperty('authorId');
    expect(group.posts[0].author).toBeNull();
  });

  it('hydrates only the current viewer salute state for group posts', () => {
    const include = (service as any).postInclude(userId);

    expect(include.likes).toEqual({ where: { userId }, select: { userId: true } });
    expect(include.saves).toEqual({ where: { userId }, select: { userId: true } });
  });

  it('selects the exact public group-member response fields', () => {
    const include = (service as any).include(true, userId);

    expect(include.members).toEqual({
      select: {
        userId: true,
        role: true,
        joinedAt: true,
        user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      },
    });
    expect(include.messages.include.channel).toEqual({ select: { id: true, name: true } });
  });

  it('derives group-message reply previews from the target message', async () => {
    prisma.message = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'message-original',
        groupId,
        channelId: 'channel-1',
        body: 'Authoritative text',
        deletedAt: null,
        sender: { displayName: null, username: 'real-author' },
      }),
    };

    await expect((service as any).messageReferenceData(groupId, 'channel-1', {
      referenceType: 'message',
      referenceId: 'message-original',
      referenceText: 'Spoofed text',
      referenceAuthorName: 'Spoofed author',
    })).resolves.toEqual({
      referenceType: 'message',
      referenceId: 'message-original',
      referenceText: 'Authoritative text',
      referenceAuthorName: 'real-author',
    });
  });
});
