import { BadRequestException } from '@nestjs/common';
import { GroupsService } from './groups.service';

describe('GroupsService', () => {
  const userId = 'user-1';
  const groupId = 'group-1';
  let prisma: any;
  let service: GroupsService;

  beforeEach(() => {
    prisma = {
      groupMember: {
        findUnique: jest.fn().mockResolvedValue({ userId, groupId, role: 'member' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      group: {
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ allowAnonymousPosts: true }),
      },
      groupChatMute: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
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
      },
      post: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'post-1', ...data })),
      },
    };
    service = new GroupsService(prisma);
  });

  it('rejects group posts without text or media', async () => {
    await expect(service.createPost(userId, groupId, { text: '   ', images: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.post.create).not.toHaveBeenCalled();
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
});
