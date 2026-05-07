import { BadRequestException } from '@nestjs/common';
import { PostVisibility } from '@prisma/client';
import { PostsService } from './posts.service';

describe('PostsService', () => {
  const authorId = 'user-1';
  let prisma: any;
  let notifications: any;
  let service: PostsService;

  beforeEach(() => {
    prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ defaultPostVisibility: PostVisibility.followers }),
        findFirst: jest.fn().mockResolvedValue({ id: 'profile-owner-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      post: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'post-1', ...data })),
      },
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    service = new PostsService(prisma, notifications);
  });

  it('rejects posts without text or media', async () => {
    await expect(service.create(authorId, { text: '   ', images: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('creates text posts using the user default post visibility', async () => {
    await service.create(authorId, { text: ' Hello #SweBud ' });

    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authorId,
        text: 'Hello #SweBud',
        visibility: PostVisibility.followers,
        hashtags: { create: [{ hashtag: { connectOrCreate: { where: { name: 'swebud' }, create: { name: 'swebud' } } } }] },
      }),
    }));
  });

  it('prefers explicit visibility over default and legacy privacy', async () => {
    await service.create(authorId, {
      text: 'private post',
      visibility: PostVisibility.public,
      privacy: PostVisibility.close_buddies,
    });

    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ visibility: PostVisibility.public }),
    }));
  });

  it('accepts legacy privacy when visibility is absent', async () => {
    await service.create(authorId, { text: 'legacy post', privacy: PostVisibility.close_buddies });

    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ visibility: PostVisibility.close_buddies }),
    }));
  });

  it('creates a post on another visible profile wall', async () => {
    await service.create(authorId, { text: 'wall post', profileUserId: 'profile-owner-1' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'profile-owner-1' }),
      select: { id: true },
    }));
    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authorId,
        profileOwnerId: 'profile-owner-1',
        text: 'wall post',
      }),
    }));
  });

  it('persists uploaded media metadata in sort order', async () => {
    await service.create(authorId, {
      images: [
        { url: '/api/uploads/posts/one.webp', mediaType: 'image', mimeType: 'image/webp', filename: 'one.webp', width: 100, height: 90 },
        { url: '/api/uploads/posts/two.mp4', type: 'video', mimeType: 'video/mp4', filename: 'two.mp4', size: 1200 },
      ],
    });

    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        images: {
          create: [
            expect.objectContaining({ url: '/api/uploads/posts/one.webp', mediaType: 'image', sortOrder: 0 }),
            expect.objectContaining({ url: '/api/uploads/posts/two.mp4', mediaType: 'video', sortOrder: 1 }),
          ],
        },
      }),
    }));
  });

  it('includes repost count in post API responses', async () => {
    prisma.post.create.mockResolvedValueOnce({
      id: 'post-1',
      authorId,
      text: 'Repostable',
      _count: { reposts: 3 },
    });

    const post = await service.create(authorId, { text: 'Repostable' });

    expect(post).toEqual(expect.objectContaining({ repostCount: 3 }));
    expect(post).not.toHaveProperty('_count');
    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        _count: { select: { reposts: true } },
      }),
    }));
  });

  it('does not expose post or author coordinates in post API responses', () => {
    const include = (service as unknown as { include(viewerId?: string): any }).include('viewer-1');
    expect(include.author.select).not.toHaveProperty('latitude');
    expect(include.author.select).not.toHaveProperty('longitude');

    const post = (service as unknown as { presentPost(post: any): any }).presentPost({
      id: 'post-1',
      latitude: 14.5995,
      longitude: 120.9842,
      author: { id: authorId, latitude: 14.5995, longitude: 120.9842 },
      _count: { reposts: 0 },
    });

    expect(post).not.toHaveProperty('latitude');
    expect(post).not.toHaveProperty('longitude');
    expect(post.author).not.toHaveProperty('latitude');
    expect(post.author).not.toHaveProperty('longitude');
  });

  it('includes comment author profile images for shared avatar rendering', () => {
    const include = (service as unknown as { commentInclude(replyTake?: number, viewerId?: string): any }).commentInclude(2, 'viewer-1');

    expect(include.author.select).toEqual(expect.objectContaining({
      id: true,
      displayName: true,
      username: true,
      profileImageUrl: true,
    }));
    expect(include.replies.include.author.select).toEqual(expect.objectContaining({
      id: true,
      displayName: true,
      username: true,
      profileImageUrl: true,
    }));
  });
});
