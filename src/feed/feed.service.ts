import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeedService {
  constructor(private prisma: PrismaService) {}

  async feed(userId: string, options: { take?: number; hashtag?: string; cursor?: number; sort?: 'relevance' | 'latest' | 'trending' | 'unseen' | 'time'; followingOnly?: boolean; savedOnly?: boolean } = {}) {
    const take = options.take ?? 20;
    const cursor = options.cursor ?? 0;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { latitude: true, longitude: true } });
    const normalizedHashtag = options.hashtag?.toLowerCase().replace(/^#/, '').trim();
    const followingIds = options.followingOnly
      ? (await this.prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } })).map((follow) => follow.followingId)
      : undefined;
    const where: any = {
      ...(normalizedHashtag ? { hashtags: { some: { hashtag: { name: normalizedHashtag } } } } : {}),
      ...(followingIds ? { authorId: { in: followingIds } } : {}),
      ...(options.savedOnly ? { saves: { some: { userId } } } : {}),
      hiddenBy: { none: { userId } },
      OR: [
        { groupId: null },
        { group: { visibility: 'public' } },
        { group: { visibility: 'private', members: { some: { userId } } } },
      ],
    };
    const posts = await this.prisma.post.findMany({
      where,
      take: 300,
      orderBy: { createdAt: 'desc' },
      include: this.postInclude(userId),
    });

    const reposts: any[] = options.savedOnly ? [] : await this.prisma.repost.findMany({
      where: {
        ...(followingIds ? { userId: { in: followingIds } } : {}),
        post: where,
      },
      take: 300,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
        post: { include: this.postInclude(userId) },
      },
    });

    const feedItems = [
      ...posts.map((post) => ({ ...post, feedItemId: `post:${post.id}`, feedItemType: 'post' as const })),
      ...reposts.map((repost) => ({
        ...repost.post,
        feedItemId: `repost:${repost.id}`,
        feedItemType: 'repost' as const,
        repostId: repost.id,
        repostText: repost.text,
        repostedAt: repost.createdAt,
        repostedBy: repost.user,
        createdAt: repost.createdAt,
      })),
    ];

    const limit = Math.min(take, 50);
    const ranked = this.sortPosts(feedItems, user, options.sort ?? 'relevance');
    return ranked.slice(cursor, cursor + limit);
  }

  async hashtags(q = '') {
    const normalized = q.toLowerCase().replace(/^#/, '').trim();
    const tags = await this.prisma.hashtag.findMany({
      where: normalized ? { name: { contains: normalized, mode: 'insensitive' } } : {},
      take: 20,
      orderBy: { name: 'asc' },
      include: { _count: { select: { posts: true } } },
    });
    return tags.map((tag) => ({ id: tag.id, name: tag.name, count: tag._count.posts })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  async trendingHashtags() {
    const tags = await this.prisma.postHashtag.groupBy({ by: ['hashtagId'], _count: { hashtagId: true }, orderBy: { _count: { hashtagId: 'desc' } }, take: 10 });
    const hashtags = await this.prisma.hashtag.findMany({ where: { id: { in: tags.map((tag) => tag.hashtagId) } } });
    return tags.map((tag) => ({ ...hashtags.find((h) => h.id === tag.hashtagId), count: tag._count.hashtagId })).filter((tag) => tag.id);
  }

  suggestedUsers(userId: string) {
    return this.prisma.user.findMany({
      where: { id: { not: userId }, followers: { none: { followerId: userId } }, blocksReceived: { none: { blockerId: userId } }, blocksSent: { none: { blockedId: userId } } },
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, displayName: true, username: true, bio: true, profileImageUrl: true },
    });
  }

  suggestedGroups(userId: string) {
    return this.prisma.group.findMany({
      where: { visibility: 'public', members: { none: { userId } } },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true, posts: true } } },
    });
  }

  private postInclude(userId: string) {
    return {
      author: { select: { id: true, displayName: true, username: true, profileImageUrl: true, latitude: true, longitude: true } },
      group: { select: { id: true, name: true, slug: true, visibility: true } },
      images: { orderBy: { sortOrder: 'asc' as const } },
      hashtags: { include: { hashtag: true } },
      saves: { where: { userId }, select: { userId: true } },
      comments: { take: 2, where: { parentId: null }, orderBy: { createdAt: 'desc' as const }, include: { author: { select: { id: true, displayName: true, username: true } } } },
    } as const;
  }

  private sortPosts(posts: Array<{ createdAt: Date; likeCount: number; commentCount: number; viewCount: number; latitude: number | null; longitude: number | null }>, user: { latitude: number | null; longitude: number | null } | null, sort: 'relevance' | 'latest' | 'trending' | 'unseen' | 'time') {
    if (sort === 'latest' || sort === 'time') return [...posts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (sort === 'trending') return [...posts].sort((a, b) => this.trendingScore(b) - this.trendingScore(a));
    if (sort === 'unseen') return [...posts].sort((a, b) => (a.viewCount - b.viewCount) || (b.createdAt.getTime() - a.createdAt.getTime()));
    return [...posts].map((post) => ({ ...post, relevanceScore: this.score(post, user) })).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private trendingScore(post: { createdAt: Date; likeCount: number; commentCount: number }) {
    const ageHours = Math.max((Date.now() - post.createdAt.getTime()) / 36e5, 0.1);
    return (post.likeCount * 2 + post.commentCount * 4 + 1) / Math.pow(ageHours + 2, 1.1);
  }

  private score(post: { createdAt: Date; likeCount: number; commentCount: number; latitude: number | null; longitude: number | null }, user?: { latitude: number | null; longitude: number | null } | null) {
    const ageHours = Math.max((Date.now() - post.createdAt.getTime()) / 36e5, 0.1);
    const freshness = 100 / Math.pow(ageHours + 2, 1.15);
    const engagement = post.likeCount * 2 + post.commentCount * 3;
    const proximity = user?.latitude != null && user.longitude != null && post.latitude != null && post.longitude != null
      ? Math.max(0, 50 - this.distanceKm(user.latitude, user.longitude, post.latitude, post.longitude))
      : 0;
    return freshness + engagement + proximity;
  }

  private distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
    const r = 6371;
    const dLat = this.rad(bLat - aLat);
    const dLon = this.rad(bLon - aLon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(this.rad(aLat)) * Math.cos(this.rad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  private rad(n: number) { return (n * Math.PI) / 180; }
}
