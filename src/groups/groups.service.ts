import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto, GroupMessageDto, GroupPostDto } from './dto';

type TrendingStats = { salutes: number; comments: number; reports: number };

@Injectable()
export class GroupsService {
  constructor(private prisma: PrismaService) {}

  create(userId: string, dto: CreateGroupDto) {
    return this.prisma.group.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug.toLowerCase(),
        description: dto.description?.trim(),
        visibility: dto.visibility ?? 'public',
        inviteCode: randomBytes(6).toString('hex'),
        members: { create: { userId, role: 'owner' } },
      },
      include: this.include(),
    });
  }

  async list(userId?: string) {
    const groups = await this.prisma.group.findMany({
      where: { OR: [{ visibility: 'public' }, ...(userId ? [{ members: { some: { userId } } }] : [])] },
      orderBy: { createdAt: 'desc' },
      include: this.include(Boolean(userId)),
    });
    return groups.map((group) => ({
      ...group,
      isMember: userId ? group.members.some((member) => member.userId === userId) : false,
      members: undefined,
    }));
  }

  async get(userId: string, slug: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { slug }, include: this.include(true) });
    const isMember = group.members.some((member) => member.userId === userId);
    if (group.visibility === 'private' && !isMember) throw new ForbiddenException('Join this private group by invite first');
    return { ...group, isMember };
  }

  async join(userId: string, groupId: string) {
    await this.prisma.groupMember.upsert({ where: { groupId_userId: { groupId, userId } }, create: { groupId, userId }, update: {} });
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { slug: true } });
    return this.get(userId, group.slug);
  }

  async joinByInvite(userId: string, inviteCode: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { inviteCode } });
    await this.join(userId, group.id);
    return this.get(userId, group.slug);
  }

  async posts(userId: string, groupId: string, filters: { sort?: 'latest' | 'trending' | 'most-commented' | 'oldest'; hashtag?: string; q?: string; mine?: boolean; take?: number; cursor?: number; timezone?: string } = {}) {
    await this.ensureCanView(userId, groupId);
    const hashtag = filters.hashtag?.toLowerCase().replace(/^#/, '').trim();
    const q = filters.q?.trim();
    const take = Math.min(filters.take ?? 10, 50);
    const cursor = filters.cursor ?? 0;
    const where = {
      groupId,
      ...(filters.mine ? { authorId: userId } : {}),
      ...(hashtag ? { hashtags: { some: { hashtag: { name: hashtag } } } } : {}),
      ...(q ? { text: { contains: q, mode: 'insensitive' as const } } : {}),
    };
    if (filters.sort === 'trending') {
      const posts = await this.prisma.post.findMany({ where, take: 500, orderBy: { createdAt: 'desc' }, include: this.postInclude() });
      const stats = await this.trendingStats(posts.map((post) => post.id), filters.timezone);
      return posts
        .sort((a, b) => this.trendingScore(b, stats.get(b.id)) - this.trendingScore(a, stats.get(a.id)) || b.createdAt.getTime() - a.createdAt.getTime())
        .slice(cursor, cursor + take);
    }
    return this.prisma.post.findMany({
      skip: cursor,
      take,
      where,
      orderBy: this.postOrderBy(filters.sort),
      include: this.postInclude(),
    });
  }

  async createPost(userId: string, groupId: string, dto: GroupPostDto) {
    await this.ensureMember(userId, groupId);
    return this.prisma.post.create({
      data: {
        groupId,
        authorId: userId,
        text: dto.text.trim(),
        hashtags: { create: this.extractHashtags(dto.text).map((name) => ({ hashtag: { connectOrCreate: { where: { name }, create: { name } } } })) },
      },
      include: this.postInclude(),
    });
  }

  async removePost(userId: string, groupId: string, postId: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { authorId: true, groupId: true } });
    if (post.groupId !== groupId) throw new ForbiddenException();
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can delete this group post');
    await this.prisma.post.delete({ where: { id: postId } });
  }

  async messages(userId: string, groupId: string) {
    await this.ensureCanView(userId, groupId);
    return this.prisma.message.findMany({ where: { groupId }, orderBy: { createdAt: 'asc' }, include: this.messageInclude() });
  }

  async sendMessage(userId: string, groupId: string, dto: GroupMessageDto) {
    await this.ensureMember(userId, groupId);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Message cannot be empty');
    return this.prisma.message.create({ data: { senderId: userId, groupId, body }, include: this.messageInclude() });
  }

  private async ensureCanView(userId: string, groupId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { visibility: true, members: { where: { userId }, select: { userId: true } } } });
    if (group.visibility === 'private' && group.members.length === 0) throw new ForbiddenException('Join this private group by invite first');
  }

  private async ensureMember(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException('Join the group first');
  }

  private messageInclude() {
    return { sender: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } } as const;
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

  private localDayUtcRange(timezone = 'UTC') {
    const safeTimezone = this.isValidTimezone(timezone) ? timezone : 'UTC';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    return { start: this.zonedTimeToUtc(year, month, day, 0, 0, safeTimezone), end: this.zonedTimeToUtc(year, month, day + 1, 0, 0, safeTimezone) };
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

  private postOrderBy(sort?: 'latest' | 'trending' | 'most-commented' | 'oldest') {
    if (sort === 'oldest') return { createdAt: 'asc' as const };
    if (sort === 'trending') return [{ likeCount: 'desc' as const }, { commentCount: 'desc' as const }, { createdAt: 'desc' as const }];
    if (sort === 'most-commented') return [{ commentCount: 'desc' as const }, { createdAt: 'desc' as const }];
    return { createdAt: 'desc' as const };
  }

  private postInclude() {
    return {
      author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      profileOwner: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      group: { select: { id: true, name: true, slug: true, visibility: true } },
      images: { orderBy: { sortOrder: 'asc' as const } },
      hashtags: { include: { hashtag: true } },
      comments: { take: 2, where: { parentId: null }, orderBy: { createdAt: 'desc' as const }, include: { author: { select: { id: true, displayName: true, username: true } } } },
    } as const;
  }

  private include(withMembers = false) {
    return {
      _count: { select: { members: true, messages: true, posts: true } },
      posts: { take: 3, orderBy: { createdAt: 'desc' as const }, include: this.postInclude() },
      ...(withMembers ? { members: { include: { user: { select: { id: true, displayName: true, profileImageUrl: true } } } } } : {}),
    } as const;
  }

  private extractHashtags(text?: string) {
    return [...new Set((text?.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.toLowerCase().replace(/^#/, '').trim()).filter(Boolean))];
  }
}
