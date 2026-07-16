import { FeedService } from './feed.service';

describe('FeedService', () => {
  let service: FeedService;

  beforeEach(() => {
    service = new FeedService({} as any);
  });

  it('presents repost count and strips internal Prisma count metadata', () => {
    const post = (service as any).sanitizeFeedPostLocation({
      id: 'post-1',
      authorId: 'user-1',
      latitude: 14.5,
      longitude: 121,
      author: { id: 'user-1', latitude: 14.5, longitude: 121 },
      _count: { reposts: 4 },
    });

    expect(post).toEqual(expect.objectContaining({ repostCount: 4 }));
    expect(post).not.toHaveProperty('_count');
    expect(post).not.toHaveProperty('latitude');
    expect(post).not.toHaveProperty('longitude');
    expect(post.author).not.toHaveProperty('latitude');
    expect(post.author).not.toHaveProperty('longitude');
  });

  it('hydrates the current viewer salute state without exposing other users likes', () => {
    const include = (service as any).postInclude('viewer-1');

    expect(include.likes).toEqual({
      where: { userId: 'viewer-1' },
      select: { userId: true },
    });
  });

  it('requires every selected hashtag when multiple hashtags are requested', async () => {
    const prisma = {
      follow: { findMany: jest.fn().mockResolvedValue([]) },
      post: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new FeedService(prisma as any);

    await service.feed('user-1', { hashtag: 'run,buddysession', sort: 'latest' });

    expect(prisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { hashtags: { some: { hashtag: { name: 'run' } } } },
          { hashtags: { some: { hashtag: { name: 'buddysession' } } } },
        ]),
      }),
    }));
  });

  it('clamps negative feed cursors and page sizes before ranking', async () => {
    const posts = [
      { id: 'post-1', authorId: 'author-1', createdAt: new Date('2026-07-16T02:00:00Z'), likeCount: 0, commentCount: 0, viewCount: 0, latitude: null, longitude: null },
      { id: 'post-2', authorId: 'author-2', createdAt: new Date('2026-07-16T01:00:00Z'), likeCount: 0, commentCount: 0, viewCount: 0, latitude: null, longitude: null },
    ];
    const prisma = {
      follow: { findMany: jest.fn().mockResolvedValue([]) },
      post: { findMany: jest.fn().mockResolvedValue(posts) },
    };
    service = new FeedService(prisma as any);

    const result = await service.feed('user-1', { take: -4, cursor: -9, sort: 'latest' });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ id: 'post-1' }));
  });

  it('records each viewer/post pair once and increments the public count once', async () => {
    let alreadyViewed = false;
    const tx = {
      postView: {
        createMany: jest.fn().mockImplementation(async () => {
          if (alreadyViewed) return { count: 0 };
          alreadyViewed = true;
          return { count: 1 };
        }),
      },
      post: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      post: { findMany: jest.fn().mockResolvedValue([{ id: 'post-1' }]) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    service = new FeedService(prisma as any);

    await expect(service.markViewed('viewer-1', ['post-1', 'post-1'])).resolves.toEqual({ count: 1 });
    await expect(service.markViewed('viewer-1', ['post-1'])).resolves.toEqual({ count: 0 });

    expect(tx.postView.createMany).toHaveBeenCalledWith({
      data: [{ postId: 'post-1', userId: 'viewer-1' }],
      skipDuplicates: true,
    });
    expect(tx.post.updateMany).toHaveBeenCalledTimes(1);
  });

  it('selects only the documented public fields for suggested groups', async () => {
    const prisma = {
      group: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'group-1',
          name: 'Runners',
          slug: 'runners',
          description: 'Run together',
          _count: { members: 4, posts: 2 },
        }]),
      },
    };
    service = new FeedService(prisma as any);

    const groups = await service.suggestedGroups('viewer-1');

    expect(prisma.group.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        _count: { select: { members: true, posts: true } },
      },
    }));
    expect(groups[0]).not.toHaveProperty('inviteCode');
  });
});
