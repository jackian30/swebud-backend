import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { visibleStoryWhere } from '../privacy/privacy';
import { CreateStoryDto, ReactStoryDto, ReplyStoryDto } from './dto';

@Injectable()
export class StoriesService {
  constructor(private prisma: PrismaService, private chat: ChatService) {}

  async create(authorId: string, dto: CreateStoryDto) {
    const text = dto.text?.trim();
    const mediaUrl = dto.mediaUrl?.trim() || undefined;
    if (!text && !mediaUrl) throw new BadRequestException('ActSnap needs text or media');
    const author = await this.prisma.user.findUniqueOrThrow({ where: { id: authorId }, select: { defaultPostVisibility: true } });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const story = await this.prisma.story.create({
      data: {
        authorId,
        text,
        textPlacement: dto.textPlacement ?? 'caption',
        mediaUrl,
        mediaType: mediaUrl ? dto.mediaType : undefined,
        mimeType: mediaUrl ? dto.mimeType : undefined,
        filename: mediaUrl ? dto.filename : undefined,
        visibility: dto.visibility ?? author.defaultPostVisibility,
        expiresAt,
      },
      include: this.include(authorId),
    });
    return this.presentStory(story, authorId);
  }

  async list(viewerId: string) {
    const stories = await this.prisma.story.findMany({
      where: this.followedVisibleStoryWhere(viewerId),
      take: 120,
      orderBy: { createdAt: 'desc' },
      include: this.include(viewerId),
    });
    const groups = new Map<string, any>();
    for (const rawStory of stories) {
      const story = this.presentStory(rawStory, viewerId);
      const group = groups.get(story.authorId) ?? {
        author: story.author,
        stories: [],
        hasUnseen: false,
        latestCreatedAt: story.createdAt,
      };
      group.stories.push(story);
      group.hasUnseen = group.hasUnseen || story.views.length === 0;
      if (story.createdAt > group.latestCreatedAt) group.latestCreatedAt = story.createdAt;
      groups.set(story.authorId, group);
    }
    return [...groups.values()]
      .map((group) => ({ ...group, stories: group.stories.sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime()) }))
      .sort((a, b) => Number(b.hasUnseen) - Number(a.hasUnseen) || b.latestCreatedAt.getTime() - a.latestCreatedAt.getTime());
  }

  async activeAuthors(viewerId: string, userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    if (!uniqueUserIds.length) return [];
    const stories = await this.prisma.story.findMany({
      where: {
        authorId: { in: uniqueUserIds },
        ...this.followedVisibleStoryWhere(viewerId),
      },
      select: { id: true, authorId: true },
      orderBy: { createdAt: 'asc' },
    });
    const firstStoryByAuthor = new Map<string, { authorId: string; storyId: string }>();
    for (const story of stories) {
      if (!firstStoryByAuthor.has(story.authorId)) {
        firstStoryByAuthor.set(story.authorId, { authorId: story.authorId, storyId: story.id });
      }
    }
    return [...firstStoryByAuthor.values()];
  }

  async view(viewerId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, ...visibleStoryWhere(viewerId) }, select: { id: true, authorId: true } });
    if (!story) throw new ForbiddenException('You cannot view this ActSnap');
    if (story.authorId === viewerId) return { viewed: true };
    const created = await this.prisma.storyView.create({ data: { storyId, userId: viewerId } }).then(() => true).catch(() => false);
    if (created) await this.prisma.story.update({ where: { id: storyId }, data: { viewCount: { increment: 1 } } });
    return { viewed: true };
  }

  async viewers(userId: string, storyId: string) {
    const story = await this.prisma.story.findUniqueOrThrow({ where: { id: storyId }, select: { authorId: true } });
    if (story.authorId !== userId) throw new ForbiddenException('Only the author can see ActSnap viewers');
    const [views, reactions] = await Promise.all([
      this.prisma.storyView.findMany({
        where: { storyId },
        orderBy: { viewedAt: 'desc' },
        include: { user: { select: this.publicUserSelect() } },
      }),
      this.prisma.storyReaction.findMany({
        where: { storyId },
        select: { userId: true, emoji: true, createdAt: true, updatedAt: true },
      }),
    ]);
    const reactionsByUser = new Map(reactions.map((reaction) => [reaction.userId, reaction]));
    return views
      .filter((view) => view.userId !== userId)
      .map((view) => ({ ...view, reaction: reactionsByUser.get(view.userId) ?? null }));
  }

  async react(userId: string, storyId: string, dto: ReactStoryDto) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, ...visibleStoryWhere(userId) }, select: { id: true } });
    if (!story) throw new ForbiddenException('You cannot react to this ActSnap');
    return this.prisma.storyReaction.upsert({
      where: { storyId_userId: { storyId, userId } },
      create: { storyId, userId, emoji: dto.emoji },
      update: { emoji: dto.emoji },
      include: { user: { select: this.publicUserSelect() } },
    });
  }

  removeReaction(userId: string, storyId: string) {
    return this.prisma.storyReaction.deleteMany({ where: { storyId, userId } }).then(() => ({ ok: true }));
  }

  async reply(userId: string, storyId: string, dto: ReplyStoryDto) {
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Reply cannot be empty');
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...visibleStoryWhere(userId) },
      select: {
        id: true,
        authorId: true,
        mediaUrl: true,
        text: true,
        author: { select: { displayName: true, username: true } },
      },
    });
    if (!story) throw new ForbiddenException('You cannot reply to this ActSnap');
    if (story.authorId === userId) throw new ForbiddenException('You cannot reply to your own ActSnap');
    return this.chat.request(userId, {
      recipientId: story.authorId,
      body,
      referenceType: 'actsnap',
      referenceId: story.id,
      referenceMediaUrl: story.mediaUrl ?? undefined,
      referenceText: story.text ?? undefined,
      referenceAuthorName: story.author.displayName || story.author.username || undefined,
    }, true);
  }

  async remove(userId: string, storyId: string) {
    const story = await this.prisma.story.findUniqueOrThrow({ where: { id: storyId }, select: { authorId: true } });
    if (story.authorId !== userId) throw new ForbiddenException('Only the author can delete this ActSnap');
    await this.prisma.story.delete({ where: { id: storyId } });
  }

  private include(viewerId: string) {
    return {
      author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      views: { where: { userId: viewerId }, select: { userId: true, viewedAt: true } },
      reactions: {
        where: { userId: viewerId },
        select: { userId: true, emoji: true, createdAt: true },
      },
    } as const;
  }

  private followedVisibleStoryWhere(viewerId: string) {
    return {
      ...visibleStoryWhere(viewerId),
      OR: [
        { authorId: viewerId },
        { author: { followers: { some: { followerId: viewerId } } } },
      ],
    };
  }

  private presentStory<T extends { authorId: string }>(story: T, viewerId: string) {
    return { ...story, viewerCanManage: story.authorId === viewerId };
  }

  private publicUserSelect() {
    return { id: true, displayName: true, username: true, profileImageUrl: true } as const;
  }
}
