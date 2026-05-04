import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto, GroupMessageDto, GroupPostDto } from './dto';

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

  list(userId?: string) {
    return this.prisma.group.findMany({
      where: { OR: [{ visibility: 'public' }, ...(userId ? [{ members: { some: { userId } } }] : [])] },
      orderBy: { createdAt: 'desc' },
      include: this.include(),
    });
  }

  async get(userId: string, slug: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { slug }, include: this.include(true) });
    const isMember = group.members.some((member) => member.userId === userId);
    if (group.visibility === 'private' && !isMember) throw new ForbiddenException('Join this private group by invite first');
    return { ...group, isMember };
  }

  join(userId: string, groupId: string) {
    return this.prisma.groupMember.upsert({ where: { groupId_userId: { groupId, userId } }, create: { groupId, userId }, update: {} });
  }

  async joinByInvite(userId: string, inviteCode: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { inviteCode } });
    await this.join(userId, group.id);
    return this.get(userId, group.slug);
  }

  async posts(userId: string, groupId: string, filters: { sort?: 'latest' | 'trending' | 'most-commented' | 'oldest'; hashtag?: string; q?: string; mine?: boolean; take?: number; cursor?: number } = {}) {
    await this.ensureCanView(userId, groupId);
    const hashtag = filters.hashtag?.toLowerCase().replace(/^#/, '').trim();
    const q = filters.q?.trim();
    const take = Math.min(filters.take ?? 10, 50);
    const cursor = filters.cursor ?? 0;
    return this.prisma.post.findMany({
      skip: cursor,
      take,
      where: {
        groupId,
        ...(filters.mine ? { authorId: userId } : {}),
        ...(hashtag ? { hashtags: { some: { hashtag: { name: hashtag } } } } : {}),
        ...(q ? { text: { contains: q, mode: 'insensitive' } } : {}),
      },
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
    return this.prisma.message.findMany({ where: { groupId }, orderBy: { createdAt: 'asc' }, include: { sender: { select: { id: true, displayName: true } } } });
  }

  async sendMessage(userId: string, groupId: string, dto: GroupMessageDto) {
    await this.ensureMember(userId, groupId);
    return this.prisma.message.create({ data: { senderId: userId, groupId, body: dto.body.trim() } });
  }

  private async ensureCanView(userId: string, groupId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { visibility: true, members: { where: { userId }, select: { userId: true } } } });
    if (group.visibility === 'private' && group.members.length === 0) throw new ForbiddenException('Join this private group by invite first');
  }

  private async ensureMember(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException('Join the group first');
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
