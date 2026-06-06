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
});
