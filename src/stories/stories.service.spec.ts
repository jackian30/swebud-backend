import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PostVisibility } from '@prisma/client';
import { StoriesService } from './stories.service';

describe('StoriesService', () => {
  const viewerId = 'viewer-1';
  let prisma: any;
  let chat: any;
  let service: StoriesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-07T09:00:00.000Z'));
    prisma = {
      story: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'actsnap-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      storyView: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      storyReaction: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ defaultPostVisibility: PostVisibility.followers }),
      },
    };
    chat = {
      request: jest.fn().mockResolvedValue({ id: 'dm-1', recipientId: 'author-1', body: 'Nice snap' }),
    };
    service = new StoriesService(prisma, chat);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects empty ActSnaps', async () => {
    await expect(service.create(viewerId, { text: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.story.create).not.toHaveBeenCalled();
  });

  it('creates disappearing ActSnaps that expire after 24 hours', async () => {
    await service.create(viewerId, {
      text: ' My update ',
      mediaUrl: ' /api/uploads/actsnaps/one.webp ',
      mediaType: 'image',
      mimeType: 'image/webp',
      filename: 'one.webp',
      visibility: PostVisibility.close_buddies,
      textPlacement: 'overlay',
    });

    expect(prisma.story.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authorId: viewerId,
        text: 'My update',
        textPlacement: 'overlay',
        mediaUrl: '/api/uploads/actsnaps/one.webp',
        mediaType: 'image',
        mimeType: 'image/webp',
        filename: 'one.webp',
        visibility: PostVisibility.close_buddies,
        expiresAt: new Date('2026-05-08T09:00:00.000Z'),
      }),
    }));
  });

  it('defaults ActSnap privacy to the user default post visibility and text placement to caption', async () => {
    await service.create(viewerId, { text: 'default snap' });

    expect(prisma.story.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        visibility: PostVisibility.followers,
        textPlacement: 'caption',
      }),
    }));
  });

  it('groups ActSnaps by author and sorts unseen authors first', async () => {
    const oldSeen = new Date('2026-05-07T08:30:00.000Z');
    const latestUnseen = new Date('2026-05-07T08:45:00.000Z');
    prisma.story.findMany.mockResolvedValue([
      { id: 'a-old', authorId: 'author-a', author: { id: 'author-a' }, views: [{ userId: viewerId }], createdAt: oldSeen },
      { id: 'b-new', authorId: 'author-b', author: { id: 'author-b' }, views: [], createdAt: latestUnseen },
      { id: 'a-new', authorId: 'author-a', author: { id: 'author-a' }, views: [{ userId: viewerId }], createdAt: new Date('2026-05-07T08:40:00.000Z') },
    ]);

    const groups = await service.list(viewerId);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ author: { id: 'author-b' }, hasUnseen: true });
    expect(groups[1]).toMatchObject({ author: { id: 'author-a' }, hasUnseen: false });
    expect(groups[1].stories.map((story: { id: string }) => story.id)).toEqual(['a-old', 'a-new']);
  });

  it('lists active ActSnaps from self and followed authors only', async () => {
    await service.list(viewerId);

    expect(prisma.story.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.any(Array),
        OR: [
          { authorId: viewerId },
          { author: { followers: { some: { followerId: viewerId } } } },
        ],
      }),
      include: expect.objectContaining({
        reactions: {
          where: { userId: viewerId },
          select: { userId: true, emoji: true, createdAt: true },
        },
      }),
      orderBy: { createdAt: 'desc' },
    }));
  });

  it('hydrates only the current viewer reaction in create and list payloads', async () => {
    await service.create(viewerId, { text: 'viewer-safe snap' });
    await service.list(viewerId);

    expect(prisma.story.create).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        reactions: expect.objectContaining({ where: { userId: viewerId } }),
      }),
    }));
    expect(prisma.story.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        reactions: expect.objectContaining({ where: { userId: viewerId } }),
      }),
    }));
  });

  it('returns visible active ActSnap authors for requested feed users', async () => {
    prisma.story.findMany.mockResolvedValue([
      { id: 'actsnap-a-old', authorId: 'author-a' },
      { id: 'actsnap-a-new', authorId: 'author-a' },
      { id: 'actsnap-b-old', authorId: 'author-b' },
    ]);

    await expect(service.activeAuthors(viewerId, ['author-a', 'author-b', 'author-a', '  '])).resolves.toEqual([
      { authorId: 'author-a', storyId: 'actsnap-a-old' },
      { authorId: 'author-b', storyId: 'actsnap-b-old' },
    ]);

    expect(prisma.story.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        authorId: { in: ['author-a', 'author-b'] },
        AND: expect.any(Array),
        OR: [
          { authorId: viewerId },
          { author: { followers: { some: { followerId: viewerId } } } },
        ],
      }),
      select: { id: true, authorId: true },
      orderBy: { createdAt: 'asc' },
    }));
  });

  it('records a view once and increments the view count only for new viewers', async () => {
    prisma.story.findFirst.mockResolvedValue({ id: 'actsnap-1', authorId: 'author-1' });

    await expect(service.view(viewerId, 'actsnap-1')).resolves.toEqual({ viewed: true });
    expect(prisma.storyView.create).toHaveBeenCalledWith({ data: { storyId: 'actsnap-1', userId: viewerId } });
    expect(prisma.story.update).toHaveBeenCalledWith({ where: { id: 'actsnap-1' }, data: { viewCount: { increment: 1 } } });

    prisma.storyView.create.mockRejectedValueOnce(new Error('duplicate'));
    await expect(service.view(viewerId, 'actsnap-1')).resolves.toEqual({ viewed: true });
    expect(prisma.story.update).toHaveBeenCalledTimes(1);
  });

  it('does not record the author as their own ActSnap viewer', async () => {
    prisma.story.findFirst.mockResolvedValue({ id: 'actsnap-1', authorId: viewerId });

    await expect(service.view(viewerId, 'actsnap-1')).resolves.toEqual({ viewed: true });

    expect(prisma.storyView.create).not.toHaveBeenCalled();
    expect(prisma.story.update).not.toHaveBeenCalled();
  });

  it('only lets the ActSnap author see viewers', async () => {
    prisma.story.findUniqueOrThrow.mockResolvedValue({ authorId: 'other-user' });

    await expect(service.viewers(viewerId, 'actsnap-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.storyView.findMany).not.toHaveBeenCalled();

    prisma.story.findUniqueOrThrow.mockResolvedValue({ authorId: viewerId });
    await service.viewers(viewerId, 'actsnap-1');

    expect(prisma.storyView.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { storyId: 'actsnap-1' },
      include: expect.objectContaining({
        user: expect.objectContaining({ select: expect.any(Object) }),
      }),
      orderBy: { viewedAt: 'desc' },
    }));
    expect(prisma.storyReaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { storyId: 'actsnap-1' },
    }));
  });

  it('includes viewer reactions when the author checks ActSnap viewers', async () => {
    prisma.story.findUniqueOrThrow.mockResolvedValue({ authorId: viewerId });
    prisma.storyView.findMany.mockResolvedValue([
      { storyId: 'actsnap-1', userId: viewerId, viewedAt: new Date('2026-05-07T08:45:00.000Z') },
      { storyId: 'actsnap-1', userId: 'buddy-1', viewedAt: new Date('2026-05-07T08:50:00.000Z') },
      { storyId: 'actsnap-1', userId: 'buddy-2', viewedAt: new Date('2026-05-07T08:55:00.000Z') },
    ]);
    prisma.storyReaction.findMany.mockResolvedValue([
      { userId: 'buddy-1', emoji: '🔥', createdAt: new Date('2026-05-07T08:51:00.000Z') },
    ]);

    await expect(service.viewers(viewerId, 'actsnap-1')).resolves.toEqual([
      expect.objectContaining({ userId: 'buddy-1', reaction: expect.objectContaining({ emoji: '🔥' }) }),
      expect.objectContaining({ userId: 'buddy-2', reaction: null }),
    ]);
  });

  it('adds or changes one reaction per viewer after visibility checks', async () => {
    prisma.story.findFirst.mockResolvedValue({ id: 'actsnap-1' });

    await service.react(viewerId, 'actsnap-1', { emoji: '🔥' });

    expect(prisma.storyReaction.upsert).toHaveBeenCalledWith({
      where: { storyId_userId: { storyId: 'actsnap-1', userId: viewerId } },
      create: { storyId: 'actsnap-1', userId: viewerId, emoji: '🔥' },
      update: { emoji: '🔥' },
      include: { user: { select: expect.any(Object) } },
    });
  });

  it('blocks reactions when the ActSnap is not visible', async () => {
    prisma.story.findFirst.mockResolvedValue(null);

    await expect(service.react(viewerId, 'private-actsnap', { emoji: '🔥' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.storyReaction.upsert).not.toHaveBeenCalled();
  });

  it('sends ActSnap replies into DM or message requests with ActSnap reference media', async () => {
    prisma.story.findFirst.mockResolvedValue({
      id: 'actsnap-1',
      authorId: 'author-1',
      mediaUrl: '/api/uploads/actsnaps/one.webp',
      text: 'Beach day',
      author: { displayName: 'Topher', username: 'tophers' },
    });

    await service.reply(viewerId, 'actsnap-1', { body: ' Nice snap ' });

    expect(chat.request).toHaveBeenCalledWith(viewerId, {
      recipientId: 'author-1',
      body: 'Nice snap',
      referenceType: 'actsnap',
      referenceId: 'actsnap-1',
      referenceMediaUrl: '/api/uploads/actsnaps/one.webp',
      referenceText: 'Beach day',
      referenceAuthorName: 'Topher',
    }, true);
  });

  it('blocks empty, invisible, and own ActSnap replies', async () => {
    await expect(service.reply(viewerId, 'actsnap-1', { body: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(chat.request).not.toHaveBeenCalled();

    prisma.story.findFirst.mockResolvedValueOnce(null);
    await expect(service.reply(viewerId, 'private-actsnap', { body: 'hello' })).rejects.toBeInstanceOf(ForbiddenException);

    prisma.story.findFirst.mockResolvedValueOnce({ id: 'actsnap-1', authorId: viewerId });
    await expect(service.reply(viewerId, 'actsnap-1', { body: 'hello' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(chat.request).not.toHaveBeenCalled();
  });

  it('blocks views when the ActSnap is not visible to the user', async () => {
    prisma.story.findFirst.mockResolvedValue(null);

    await expect(service.view(viewerId, 'private-actsnap')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.storyView.create).not.toHaveBeenCalled();
  });

  it('only lets the author delete an ActSnap', async () => {
    prisma.story.findUniqueOrThrow.mockResolvedValue({ authorId: 'other-user' });

    await expect(service.remove(viewerId, 'actsnap-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.story.delete).not.toHaveBeenCalled();

    prisma.story.findUniqueOrThrow.mockResolvedValue({ authorId: viewerId });
    await service.remove(viewerId, 'actsnap-1');
    expect(prisma.story.delete).toHaveBeenCalledWith({ where: { id: 'actsnap-1' } });
  });
});
