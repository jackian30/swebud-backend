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
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'post-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'post-1', authorId, text: 'read only' }),
        update: jest.fn(),
      },
      postEditHistory: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      groupMember: { findUnique: jest.fn().mockResolvedValue({ role: 'member' }) },
      comment: {
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
      },
      follow: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    service = new PostsService(prisma, notifications);
  });

  it('rejects posts without text or media', async () => {
    await expect(service.create(authorId, { text: '   ', images: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('clamps post-list page size to a positive bounded value', async () => {
    await service.list(authorId, -20);

    expect(prisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });

  it('does not allow an edit to empty a text-only comment', async () => {
    prisma.comment.findUniqueOrThrow.mockResolvedValueOnce({
      authorId,
      postId: 'post-1',
      body: 'Original comment',
      images: [],
    });

    await expect(service.updateComment(authorId, 'post-1', 'comment-1', { body: '   ' }))
      .rejects.toThrow('Comment needs text or an image');
  });

  it('creates text posts using the user default post visibility', async () => {
    await service.create(authorId, { text: ' Hello #SweBudd ' });

    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authorId,
        text: 'Hello #SweBudd',
        visibility: PostVisibility.followers,
        hashtags: { create: [{ hashtag: { connectOrCreate: { where: { name: 'swebudd' }, create: { name: 'swebudd' } } } }] },
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

  it('allows tagging users the author follows', async () => {
    prisma.follow.findMany.mockResolvedValueOnce([{ followingId: 'user-2' }]);

    await service.create(authorId, { text: 'with tag', taggedUserIds: ['user-2'] });

    expect(prisma.follow.findMany).toHaveBeenCalledWith({
      where: { followerId: authorId, followingId: { in: ['user-2'] } },
      select: { followingId: true },
    });
    expect(prisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taggedUsers: { create: [{ userId: 'user-2' }] },
      }),
    }));
  });

  it('rejects tagging users the author does not follow', async () => {
    prisma.follow.findMany.mockResolvedValueOnce([]);

    await expect(service.create(authorId, { text: 'bad tag', taggedUserIds: ['user-2'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('only notifies mentioned users the author follows', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'user-2' }]);

    await service.create(authorId, { text: 'hello @seedbuddy' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ username: { equals: 'seedbuddy', mode: 'insensitive' } }],
        followers: { some: { followerId: authorId } },
      }),
      select: { id: true },
    }));
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      actorId: authorId,
      type: 'mention',
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

  it('hydrates only the current viewer like and save state on every post surface', () => {
    const include = (service as unknown as { include(viewerId?: string): any }).include('viewer-1');

    expect(include.likes).toEqual({ where: { userId: 'viewer-1' }, select: { userId: true } });
    expect(include.saves).toEqual({ where: { userId: 'viewer-1' }, select: { userId: true } });
  });

  it('keeps GET post retrieval read-only', async () => {
    await expect(service.get('post-1', 'viewer-1')).resolves.toEqual(expect.objectContaining({
      id: 'post-1',
      text: 'read only',
    }));

    expect(prisma.post.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'post-1' },
    }));
    expect(prisma.post.update).not.toHaveBeenCalled();
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

  it('uses one comment presenter for read and write responses', () => {
    const comment = (service as unknown as { presentComment(comment: any, viewerId?: string): any }).presentComment({
      id: 'comment-1',
      authorId,
      body: 'Comment',
      images: [{
        id: 'image-1',
        commentId: 'comment-1',
        url: '/uploads/comments/image.webp',
        alt: null,
        filename: 'image.webp',
        mimeType: 'image/webp',
        size: 120,
        width: 80,
        height: 60,
        sortOrder: 0,
        createdAt: new Date('2026-07-16T00:00:00.000Z'),
      }],
      replies: [{ id: 'reply-1', authorId: 'other-user' }],
      _count: { replies: 3 },
    }, authorId);

    expect(comment).toEqual(expect.objectContaining({
      id: 'comment-1',
      viewerCanManage: true,
      replyCount: 3,
      nextReplyCursor: 1,
      replies: [expect.objectContaining({ id: 'reply-1', viewerCanManage: false })],
    }));
    expect(comment).not.toHaveProperty('_count');
    expect(comment.images[0]).toHaveProperty('commentId', 'comment-1');
    expect(comment.images[0]).not.toHaveProperty('postId');
  });

  it('sorts top comments by salute count, reply count, then newest fallback', async () => {
    await service.comments('post-1', { sort: 'top', take: 10, cursor: 0 });

    expect(prisma.comment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { postId: 'post-1', parentId: null },
      orderBy: [{ likeCount: 'desc' }, { replies: { _count: 'desc' } }, { createdAt: 'desc' }],
      skip: 0,
      take: 11,
    }));
  });

  it('returns a limited comment page with a next cursor', async () => {
    prisma.comment.findMany.mockResolvedValueOnce([
      { id: 'comment-1', authorId },
      { id: 'comment-2', authorId },
      { id: 'comment-3', authorId },
    ]);

    const page = await service.comments('post-1', { sort: 'newest', take: 2, cursor: 4 });

    expect(page).toEqual({
      items: [
        expect.objectContaining({ id: 'comment-1', viewerCanManage: false }),
        expect.objectContaining({ id: 'comment-2', viewerCanManage: false }),
      ],
      nextCursor: 6,
    });
    expect(prisma.comment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }],
      include: expect.objectContaining({
        _count: { select: { replies: true } },
        replies: expect.objectContaining({ take: 20 }),
      }),
      skip: 4,
      take: 3,
    }));
  });

  it('blocks ordinary viewers from anonymous post edit-history identity', async () => {
    prisma.post.findUniqueOrThrow.mockResolvedValue({
      id: 'post-1',
      authorId,
      groupId: 'group-1',
      isAnonymous: true,
    });

    await expect(service.postHistory('viewer-1', 'post-1')).rejects.toThrow('Anonymous post history is private');

    expect(prisma.groupMember.findUnique).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: 'group-1', userId: 'viewer-1' } },
      select: { role: true },
    });
    expect(prisma.postEditHistory.findMany).not.toHaveBeenCalled();
  });

  it('never selects editor identity when a moderator reviews anonymous post history', async () => {
    prisma.post.findUniqueOrThrow.mockResolvedValue({
      id: 'post-1',
      authorId,
      groupId: 'group-1',
      isAnonymous: true,
    });
    prisma.groupMember.findUnique.mockResolvedValue({ role: 'moderator' });

    await service.postHistory('moderator-1', 'post-1');

    expect(prisma.postEditHistory.findMany).toHaveBeenCalledWith({
      where: { postId: 'post-1' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, oldText: true, newText: true, createdAt: true },
    });
  });

  it('paginates replies independently from root comments', async () => {
    prisma.comment.findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'comment-1',
      postId: 'post-1',
      parentId: null,
    });
    prisma.comment.findMany.mockResolvedValue([
      { id: 'reply-1', authorId },
      { id: 'reply-2', authorId },
      { id: 'reply-3', authorId },
    ]);

    await expect(service.replies('post-1', 'comment-1', { take: 2, cursor: 4 }, 'viewer-1')).resolves.toEqual({
      items: [expect.objectContaining({ id: 'reply-1' }), expect.objectContaining({ id: 'reply-2' })],
      nextCursor: 6,
    });
    expect(prisma.comment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { postId: 'post-1', parentId: 'comment-1' },
      skip: 4,
      take: 3,
    }));
  });

  it('reconciles extracted hashtags transactionally when post text changes', async () => {
    prisma.post.findUniqueOrThrow.mockResolvedValue({
      authorId,
      text: 'Old #stale',
      images: [],
      taggedUsers: [],
    });
    const tx = {
      postEditHistory: { create: jest.fn().mockResolvedValue({}) },
      post: {
        update: jest.fn().mockResolvedValue({ id: 'post-1', authorId, text: 'New #Fresh #fresh' }),
      },
    };
    prisma.$transaction = jest.fn((callback: (client: typeof tx) => unknown) => callback(tx));

    await service.update(authorId, 'post-1', { text: 'New #Fresh #fresh' });

    expect(tx.post.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        hashtags: {
          deleteMany: {},
          create: [{ hashtag: { connectOrCreate: { where: { name: 'fresh' }, create: { name: 'fresh' } } } }],
        },
      }),
    }));
  });
});
