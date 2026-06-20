import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { visiblePostWhere } from '../privacy/privacy';
import { activityPersonaLinkSelect } from '../common/activity-personas';

type TrendingStats = { salutes: number; comments: number; reports: number };
type FeedRankingContext = {
  user: { latitude: number | null; longitude: number | null; activityPersonas: Array<{ persona: string }> } | null;
  followingIds: Set<string>;
  preferredHashtags: Set<string>;
};

@Injectable()
export class FeedService {
  constructor(private prisma: PrismaService) {}

  async feed(userId: string, options: { take?: number; hashtag?: string; cursor?: number; sort?: 'relevance' | 'latest' | 'trending' | 'unseen' | 'time'; followingOnly?: boolean; savedOnly?: boolean; timezone?: string } = {}) {
    const requestedTake = options.take ?? 20;
    const sort = options.sort ?? 'relevance';
    const cursor = options.cursor ?? 0;
    const normalizedHashtags = this.normalizeHashtags(options.hashtag);
    const needsRelevanceContext = sort === 'relevance';
    const [user, followingRows, preferredHashtags] = await Promise.all([
      needsRelevanceContext
        ? this.prisma.user.findUnique({ where: { id: userId }, select: { latitude: true, longitude: true, activityPersonas: activityPersonaLinkSelect } })
        : Promise.resolve(null),
      this.prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
      needsRelevanceContext ? this.userPreferredHashtags(userId) : Promise.resolve(new Set<string>()),
    ]);
    const followingIds = followingRows.map((follow) => follow.followingId);
    const followingFilterIds = options.followingOnly ? followingIds : undefined;
    const followedReposterIds = followingIds.filter((id) => id !== userId);
    const followedRepostAudience = followedReposterIds.length ? { reposts: { some: { userId: { in: followedReposterIds } } } } : null;
    const groupAudience = [
      { group: { members: { some: { userId } } } },
      { group: { visibility: 'public' as const } },
    ];
    const feedAudienceWhere = followingFilterIds
      ? {
        OR: [
          { authorId: { in: [userId, ...followingFilterIds] } },
          { profileOwnerId: { in: [userId, ...followingFilterIds] } },
          ...(followedRepostAudience ? [followedRepostAudience] : []),
        ],
      }
      : {
        OR: [
          { authorId: userId },
          { authorId: { in: followingIds } },
          { author: { profileVisibility: 'public' } },
          { profileOwnerId: userId },
          { profileOwnerId: { in: followingIds } },
          { profileOwner: { profileVisibility: 'public' } },
          ...(followedRepostAudience ? [followedRepostAudience] : []),
          ...groupAudience,
        ],
      };
    const where: any = {
      AND: [
        visiblePostWhere(userId),
        feedAudienceWhere,
        ...normalizedHashtags.map((name) => ({ hashtags: { some: { hashtag: { name } } } })),
        {
          ...(options.savedOnly ? { saves: { some: { userId } } } : {}),
          hiddenBy: { none: { userId } },
        },
      ],
    };
    const limit = Math.min(requestedTake, 50);
    const candidateTake = this.candidateTake(cursor, limit, sort);
    const posts = await this.prisma.post.findMany({
      where,
      take: candidateTake,
      orderBy: { createdAt: 'desc' },
      include: this.postInclude(userId),
    });

    const reposts: any[] = options.savedOnly || followedReposterIds.length === 0 ? [] : await this.prisma.repost.findMany({
      where: {
        userId: { in: followedReposterIds },
        post: where,
      },
      take: candidateTake,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
        likes: { where: { userId }, select: { userId: true } },
        post: { include: this.postInclude(userId) },
      },
    });

    const repostGroups = new Map<string, any[]>();
    for (const repost of reposts) {
      const group = repostGroups.get(repost.postId) ?? [];
      group.push(repost);
      repostGroups.set(repost.postId, group);
    }
    const groupedRepostItems = [...repostGroups.values()].map((group) => {
      const sorted = group.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const latest = sorted[0];
      return {
        ...latest.post,
        feedItemId: `repost:${latest.postId}:${sorted.map((item) => item.userId).join(',')}`,
        feedItemType: 'repost' as const,
        repostId: latest.id,
        repostText: latest.text,
        repostedAt: latest.createdAt,
        repostedBy: latest.user,
        repostedByUsers: sorted.map((item) => item.user),
        repostLikeCount: latest.likeCount,
        repostLikes: latest.likes,
        likeCount: latest.likeCount,
        createdAt: latest.createdAt,
      };
    });

    const feedItems = [
      ...posts.map((post) => ({ ...post, feedItemId: `post:${post.id}`, feedItemType: 'post' as const })),
      ...groupedRepostItems,
    ];

    const postIds = feedItems.map((post) => post.id);
    const trendingStats = sort === 'trending' ? await this.trendingStats(postIds, options.timezone) : new Map<string, TrendingStats>();
    const viewedByPostId = await this.viewedByPostId(userId, postIds, sort);
    const latestActivityByPostId = sort === 'relevance' ? await this.latestActivityByPostId(postIds) : new Map<string, Date>();
    const rankingContext: FeedRankingContext = { user, followingIds: new Set(followingIds), preferredHashtags };
    const ranked = this.sortPosts(feedItems, rankingContext, viewedByPostId, latestActivityByPostId, sort, trendingStats);
    return ranked.slice(cursor, cursor + limit).map((post) => this.sanitizeFeedPostLocation(post));
  }

  private candidateTake(cursor: number, limit: number, sort: 'relevance' | 'latest' | 'trending' | 'unseen' | 'time') {
    const minimum = sort === 'relevance' || sort === 'trending' ? 120 : 80;
    return Math.min(Math.max(cursor + limit * 4, minimum), 300);
  }

  private normalizeHashtags(value?: string) {
    return [...new Set((value ?? '')
      .split(',')
      .map((tag) => tag.toLowerCase().replace(/^#/, '').trim())
      .filter(Boolean))];
  }

  private async viewedByPostId(userId: string, postIds: string[], sort: 'relevance' | 'latest' | 'trending' | 'unseen' | 'time') {
    if (sort !== 'relevance' && sort !== 'unseen') return new Map<string, { count: number; lastViewedAt: Date }>();
    const ids = [...new Set(postIds)].filter(Boolean);
    if (!ids.length) return new Map<string, { count: number; lastViewedAt: Date }>();
    const viewed = await this.prisma.postView.findMany({
      where: { userId, postId: { in: ids } },
      select: { postId: true, count: true, lastViewedAt: true },
    });
    return new Map(viewed.map((view) => [view.postId, view]));
  }

  async markViewed(userId: string, postIds: string[]) {
    const uniqueIds = [...new Set(postIds)].filter(Boolean).slice(0, 100);
    if (!uniqueIds.length) return { count: 0 };
    const visibleIds = (await this.prisma.post.findMany({ where: { id: { in: uniqueIds }, ...visiblePostWhere(userId) }, select: { id: true } })).map((post) => post.id);
    if (!visibleIds.length) return { count: 0 };
    await this.prisma.$transaction([
      ...visibleIds.map((postId) => this.prisma.postView.upsert({
        where: { postId_userId: { postId, userId } },
        update: { count: { increment: 1 } },
        create: { postId, userId },
      })),
      this.prisma.post.updateMany({ where: { id: { in: visibleIds } }, data: { viewCount: { increment: 1 } } }),
    ]);
    return { count: visibleIds.length };
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
      where: { id: { not: userId }, profileVisibility: { not: 'private' }, followers: { none: { followerId: userId } }, blocksReceived: { none: { blockerId: userId } }, blocksSent: { none: { blockedId: userId } } },
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
      author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      profileOwner: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      activity: { select: this.activitySelect() },
      group: { select: { id: true, name: true, slug: true, visibility: true } },
      images: { orderBy: { sortOrder: 'asc' as const } },
      hashtags: { include: { hashtag: true } },
      taggedUsers: { include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } }, orderBy: { createdAt: 'asc' as const } },
      buddySessionRecap: true,
      saves: { where: { userId }, select: { userId: true } },
      comments: { take: 2, where: { parentId: null }, orderBy: { createdAt: 'desc' as const }, include: { author: { select: { id: true, displayName: true, username: true } } } },
      _count: { select: { reposts: true } },
    } as const;
  }

  private activitySelect() {
    return {
      id: true,
      source: true,
      type: true,
      title: true,
      startedAt: true,
      durationSeconds: true,
      distanceMeters: true,
      elevationGainMeters: true,
      calories: true,
      averageHeartRate: true,
      maxHeartRate: true,
      averagePaceSecondsKm: true,
      averageSpeedMetersSec: true,
    } as const;
  }

  private sanitizeFeedPostLocation<T extends { latitude?: number | null; longitude?: number | null; author?: { latitude?: number | null; longitude?: number | null } | null; _count?: { reposts?: number } | null }>(post: T) {
    const { _count, ...safePost } = { ...post };
    (safePost as T & { repostCount: number }).repostCount = _count?.reposts ?? 0;
    delete safePost.latitude;
    delete safePost.longitude;
    if (safePost.author) {
      const safeAuthor = { ...safePost.author };
      delete safeAuthor.latitude;
      delete safeAuthor.longitude;
      safePost.author = safeAuthor;
    }
    return safePost;
  }

  private sortPosts(
    posts: Array<{ id: string; authorId: string; createdAt: Date; likeCount: number; commentCount: number; viewCount: number; latitude: number | null; longitude: number | null }>,
    context: FeedRankingContext,
    viewedByPostId: Map<string, { count: number; lastViewedAt: Date }>,
    latestActivityByPostId: Map<string, Date>,
    sort: 'relevance' | 'latest' | 'trending' | 'unseen' | 'time',
    trendingStats: Map<string, TrendingStats> = new Map(),
  ) {
    const hydrated = posts.map((post) => ({ ...post, viewerView: viewedByPostId.get(post.id) ?? null, latestActivityAt: latestActivityByPostId.get(post.id) ?? null }));
    if (sort === 'latest' || sort === 'time') return hydrated.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (sort === 'trending') return hydrated.sort((a, b) => this.trendingScore(b, trendingStats.get(b.id)) - this.trendingScore(a, trendingStats.get(a.id)) || b.createdAt.getTime() - a.createdAt.getTime());
    if (sort === 'unseen') return hydrated.sort((a, b) => Number(Boolean(a.viewerView)) - Number(Boolean(b.viewerView)) || b.createdAt.getTime() - a.createdAt.getTime());
    const scored = hydrated
      .map((post, index) => {
        const staleViewed = this.isStaleViewed(post.viewerView, post.latestActivityAt);
        return {
          ...post,
          staleViewed,
          baseRelevanceScore: this.score(post, context, index) - this.viewPenalty(post.viewerView, post.latestActivityAt),
        };
      })
      .sort((a, b) => Number(a.staleViewed) - Number(b.staleViewed) || b.baseRelevanceScore - a.baseRelevanceScore);
    const freshOrActive = this.applyAuthorDiversity(scored.filter((post) => !post.staleViewed));
    const staleViewed = this.applyAuthorDiversity(scored.filter((post) => post.staleViewed));
    return [...freshOrActive, ...staleViewed];
  }

  private trendingScore(post: { createdAt: Date }, stats: TrendingStats = { salutes: 0, comments: 0, reports: 0 }) {
    const ageHours = Math.max((Date.now() - post.createdAt.getTime()) / 36e5, 0.1);
    const engagement = stats.salutes * 2 + stats.comments * 4 - stats.reports * 8;
    return (Math.max(engagement, 0) + 1) / Math.pow(ageHours + 2, 0.75);
  }

  private async trendingStats(postIds: string[], timezone?: string) {
    const ids = [...new Set(postIds)].filter(Boolean);
    if (!ids.length) return new Map<string, TrendingStats>();
    const { start, end } = this.localDayUtcRange(timezone);
    const [salutes, comments, reports] = await Promise.all([
      this.prisma.postLike.groupBy({ by: ['postId'], where: { postId: { in: ids }, createdAt: { gte: start, lt: end } }, _count: { postId: true } }),
      this.prisma.comment.groupBy({ by: ['postId'], where: { postId: { in: ids }, createdAt: { gte: start, lt: end } }, _count: { postId: true } }),
      this.prisma.postReport.groupBy({ by: ['postId'], where: { postId: { in: ids }, createdAt: { gte: start, lt: end } }, _count: { postId: true } }),
    ]);
    const map = new Map<string, TrendingStats>();
    const ensure = (postId: string) => {
      const existing = map.get(postId) ?? { salutes: 0, comments: 0, reports: 0 };
      map.set(postId, existing);
      return existing;
    };
    for (const row of salutes) ensure(row.postId).salutes = row._count.postId;
    for (const row of comments) ensure(row.postId).comments = row._count.postId;
    for (const row of reports) ensure(row.postId).reports = row._count.postId;
    return map;
  }

  private async latestActivityByPostId(postIds: string[]) {
    const ids = [...new Set(postIds)].filter(Boolean);
    const map = new Map<string, Date>();
    if (!ids.length) return map;
    const [likes, comments, reposts] = await Promise.all([
      this.prisma.postLike.groupBy({ by: ['postId'], where: { postId: { in: ids } }, _max: { createdAt: true } }),
      this.prisma.comment.groupBy({ by: ['postId'], where: { postId: { in: ids } }, _max: { createdAt: true } }),
      this.prisma.repost.groupBy({ by: ['postId'], where: { postId: { in: ids } }, _max: { createdAt: true } }),
    ]);
    const remember = (postId: string, date?: Date | null) => {
      if (!date) return;
      const existing = map.get(postId);
      if (!existing || date.getTime() > existing.getTime()) map.set(postId, date);
    };
    for (const row of likes) remember(row.postId, row._max.createdAt);
    for (const row of comments) remember(row.postId, row._max.createdAt);
    for (const row of reposts) remember(row.postId, row._max.createdAt);
    return map;
  }

  private localDayUtcRange(timezone = 'UTC') {
    const safeTimezone = this.isValidTimezone(timezone) ? timezone : 'UTC';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const start = this.zonedTimeToUtc(year, month, day, 0, 0, safeTimezone);
    const end = this.zonedTimeToUtc(year, month, day + 1, 0, 0, safeTimezone);
    return { start, end };
  }

  private zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
    let utc = new Date(Date.UTC(year, month - 1, day, hour, minute));
    for (let i = 0; i < 2; i += 1) utc = new Date(Date.UTC(year, month - 1, day, hour, minute) - this.timezoneOffsetMs(utc, timezone));
    return utc;
  }

  private timezoneOffsetMs(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour') % 24, value('minute'), value('second')) - date.getTime();
  }

  private isValidTimezone(timezone?: string) {
    if (!timezone) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); return true; } catch { return false; }
  }

  private score(
    post: { id: string; authorId: string; createdAt: Date; likeCount: number; commentCount: number; latitude: number | null; longitude: number | null; hashtags?: { hashtag?: { name: string } | null }[] },
    context: FeedRankingContext,
    index = 0,
  ) {
    const ageHours = Math.max((Date.now() - post.createdAt.getTime()) / 36e5, 0.1);
    const freshness = 90 / Math.pow(ageHours + 2, 1.05);
    const engagement = Math.log1p(post.likeCount * 2 + post.commentCount * 4) * 12;
    const following = context.followingIds.has(post.authorId) ? 20 : 0;
    const hashtagAffinity = this.hashtagAffinity(post, context.preferredHashtags) * 100;
    const activityAffinity = this.activityAffinity(post, context.user?.activityPersonas.map((item) => item.persona) ?? []) * 85;
    const proximity = this.proximityScore(post, context.user);
    const exploration = this.randomDiscoveryScore(post.id, index) * 280;
    return following + hashtagAffinity + activityAffinity + proximity + freshness + engagement + exploration;
  }

  private hashtagAffinity(post: { hashtags?: { hashtag?: { name: string } | null }[] }, preferredHashtags: Set<string>) {
    if (!preferredHashtags.size || !post.hashtags?.length) return 0;
    return Math.min(post.hashtags.filter((tag) => preferredHashtags.has(tag.hashtag?.name ?? '')).length, 3);
  }

  private activityAffinity(post: { hashtags?: { hashtag?: { name: string } | null }[] }, activityPersonas: string[]) {
    if (!activityPersonas.length || !post.hashtags?.length) return 0;
    const activityTags = new Set(activityPersonas.flatMap((activityPersona) => [...this.activityHashtags(activityPersona)]));
    return post.hashtags.some((tag) => activityTags.has(tag.hashtag?.name ?? '')) ? 1 : 0;
  }

  private proximityScore(post: { latitude: number | null; longitude: number | null }, user?: { latitude: number | null; longitude: number | null } | null) {
    if (user?.latitude == null || user.longitude == null || post.latitude == null || post.longitude == null) return 0;
    const distance = this.distanceKm(user.latitude, user.longitude, post.latitude, post.longitude);
    if (distance <= 20) return 80 + (20 - distance) * 6;
    return Math.max(0, 25 - Math.log1p(distance - 20) * 5);
  }

  private randomDiscoveryScore(postId: string, index: number) {
    return (this.hash(`${postId}:${new Date().toISOString().slice(0, 10)}`) % 1000) / 1000 + (index % 11) / 50;
  }

  private async userPreferredHashtags(userId: string) {
    const ownPostIds = (await this.prisma.post.findMany({ where: { authorId: userId }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 100 })).map((post) => post.id);
    if (!ownPostIds.length) return new Set<string>();
    const grouped = await this.prisma.postHashtag.groupBy({ by: ['hashtagId'], where: { postId: { in: ownPostIds } }, _count: { hashtagId: true }, orderBy: { _count: { hashtagId: 'desc' } }, take: 12 });
    const tags = await this.prisma.hashtag.findMany({ where: { id: { in: grouped.map((tag) => tag.hashtagId) } }, select: { name: true } });
    return new Set(tags.map((tag) => tag.name));
  }

  private activityHashtags(activityPersona: string) {
    const tags: Record<string, string[]> = {
      runner: ['running', 'run', 'runner', 'jogging', 'cardio'],
      bodybuilder: ['gym', 'bodybuilding', 'fitness', 'lifting', 'muscle'],
      cyclist: ['cycling', 'bike', 'biking', 'ride'],
      yogi: ['yoga', 'mobility', 'stretching'],
      swimmer: ['swimming', 'swim'],
      powerlifter: ['powerlifting', 'lifting', 'squat', 'bench', 'deadlift', 'gym'],
      crossfitter: ['crossfit', 'hiit', 'functional', 'gym'],
      walker: ['walking', 'walk', 'steps'],
      hiker: ['hiking', 'hike', 'trail', 'outdoors'],
      climber: ['climbing', 'climb', 'bouldering'],
      martial_artist: ['martialarts', 'boxing', 'muaythai', 'bjj', 'mma', 'karate', 'taekwondo'],
      dancer: ['dance', 'dancing', 'zumba'],
      pilates: ['pilates', 'core', 'mobility'],
      calisthenics: ['calisthenics', 'bodyweight', 'pullups', 'pushups'],
      rower: ['rowing', 'row', 'erg'],
      triathlete: ['triathlon', 'swim', 'bike', 'run', 'running', 'cycling', 'swimming'],
      soccer_player: ['soccer', 'football', 'futbol'],
      basketball_player: ['basketball', 'hoops'],
      other: [],
    };
    return new Set(tags[activityPersona] ?? []);
  }

  private hash(value: string) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    return hash;
  }

  private viewPenalty(view?: { count: number; lastViewedAt: Date } | null, latestActivityAt?: Date | null) {
    if (!view) return 0;
    const hours = Math.max((Date.now() - view.lastViewedAt.getTime()) / 36e5, 0.1);
    const hasNewActivity = Boolean(latestActivityAt && latestActivityAt.getTime() > view.lastViewedAt.getTime());
    const recencyPenalty = 650 / Math.pow(hours + 2, 0.35);
    const repeatPenalty = Math.min(view.count, 10) * 95;
    const staleSeenPenalty = hasNewActivity ? 0 : 1500;
    const recoveryFactor = hasNewActivity ? 0.35 : 1;
    return (recencyPenalty + repeatPenalty) * recoveryFactor + staleSeenPenalty;
  }

  private isStaleViewed(view?: { count: number; lastViewedAt: Date } | null, latestActivityAt?: Date | null) {
    return Boolean(view && (!latestActivityAt || latestActivityAt.getTime() <= view.lastViewedAt.getTime()));
  }

  private applyAuthorDiversity<T extends { authorId: string; baseRelevanceScore: number }>(posts: T[]) {
    const authorRanks = new Map<string, number>();
    return posts
      .map((post) => {
        const authorRank = authorRanks.get(post.authorId) ?? 0;
        authorRanks.set(post.authorId, authorRank + 1);
        return { ...post, relevanceScore: post.baseRelevanceScore - this.authorDiversityPenalty(authorRank) };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private authorDiversityPenalty(authorRank: number) {
    if (authorRank <= 0) return 0;
    return 500 + authorRank * 260;
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
