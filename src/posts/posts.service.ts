import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertCanViewPost, visibleAuthorWhere, visiblePostWhere } from '../privacy/privacy';
import { CommentDto, CreatePostDto, ReportPostDto, RepostDto, UpdateCommentDto, UpdatePostDto } from './dto';

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async create(authorId: string, dto: CreatePostDto) {
    if (!dto.text?.trim() && !dto.images?.length) throw new BadRequestException('Post needs text or at least one image');
    const author = await this.prisma.user.findUniqueOrThrow({ where: { id: authorId }, select: { defaultPostVisibility: true } });
    const profileOwnerId = (dto.profileOwnerId ?? dto.targetUserId ?? dto.profileUserId)?.trim() || null;
    if (profileOwnerId && profileOwnerId !== authorId) await this.ensureCanPostOnProfile(authorId, profileOwnerId);
    const hashtags = [...new Set((dto.hashtags ?? this.extractHashtags(dto.text)).map((t) => t.toLowerCase().replace(/^#/, '').trim()).filter(Boolean))];
    const taggedUserIds = await this.validateTaggedUsers(authorId, this.taggedUserIds(dto));
    if (dto.activityId) await this.ensureOwnsActivity(authorId, dto.activityId);
    const text = dto.text?.trim();
    const post = await this.prisma.post.create({
      data: {
        authorId,
        profileOwnerId: profileOwnerId || undefined,
        text,
        visibility: dto.visibility ?? dto.privacy ?? author.defaultPostVisibility,
        activityId: dto.activityId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        images: { create: (dto.images ?? []).map((image, sortOrder) => ({
          url: image.url,
          alt: image.alt,
          mediaType: image.mediaType ?? image.type ?? 'image',
          mimeType: image.mimeType,
          filename: image.filename,
          size: image.size,
          width: image.width,
          height: image.height,
          sortOrder,
        })) },
        hashtags: { create: hashtags.map((name) => ({ hashtag: { connectOrCreate: { where: { name }, create: { name } } } })) },
        taggedUsers: { create: taggedUserIds.map((userId) => ({ userId })) },
      },
      include: this.include(),
    });
    this.notifyTaggedUsers(authorId, post.id, taggedUserIds);
    await this.notifyMentionedUsers(authorId, post.id, text ?? '', 'Someone mentioned you in a post.');
    return this.presentPost(post);
  }

  list(viewerId: string, take = 20, cursor?: string) {
    return this.prisma.post.findMany({
      where: visiblePostWhere(viewerId),
      take: Math.min(take, 50),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: this.include(),
    }).then((posts) => posts.map((post) => this.presentPost(post)));
  }

  async get(id: string, viewerId?: string) {
    if (viewerId) await this.ensureCanViewPost(viewerId, id);
    await this.prisma.post.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => null);
    return this.prisma.post.findUniqueOrThrow({ where: { id }, include: this.include(viewerId) }).then((post) => this.presentPost(post));
  }

  async remove(userId: string, id: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id }, select: { authorId: true } });
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can delete this post');
    await this.prisma.post.delete({ where: { id } });
  }


  async update(userId: string, id: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id }, select: { authorId: true, text: true, images: { orderBy: { sortOrder: 'asc' } }, taggedUsers: { select: { userId: true } } } });
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can edit this post');
    const nextTaggedUserIds = this.taggedUserIds(dto);
    const taggedUserIds = nextTaggedUserIds ? await this.validateTaggedUsers(userId, nextTaggedUserIds) : undefined;
    const newText = dto.text === undefined ? undefined : dto.text.trim();
    const finalText = newText === undefined ? post.text : newText;
    const nextImages = dto.images;
    const finalImageCount = nextImages === undefined ? post.images.length : nextImages.length;
    if (!finalText && finalImageCount === 0) throw new BadRequestException('Post needs text or at least one image');
    if (dto.activityId) await this.ensureOwnsActivity(userId, dto.activityId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.text !== undefined && (post.text ?? '') !== (newText ?? '')) {
        await tx.postEditHistory.create({ data: { postId: id, editorId: userId, oldText: post.text, newText } });
      }
      if (nextImages !== undefined) {
        await tx.postImage.deleteMany({ where: { postId: id } });
        if (nextImages.length) {
          await tx.postImage.createMany({ data: nextImages.map((image, sortOrder) => ({
            postId: id,
            url: image.url,
            alt: image.alt,
            mediaType: image.mediaType ?? image.type ?? 'image',
            mimeType: image.mimeType,
            filename: image.filename,
            size: image.size,
            width: image.width,
            height: image.height,
            sortOrder,
          })) });
        }
      }
      if (taggedUserIds !== undefined) {
        await tx.postTag.deleteMany({ where: { postId: id } });
        if (taggedUserIds.length) await tx.postTag.createMany({ data: taggedUserIds.map((taggedUserId) => ({ postId: id, userId: taggedUserId })), skipDuplicates: true });
      }
      const updated = await tx.post.update({ where: { id }, data: { text: newText, visibility: dto.visibility ?? dto.privacy, activityId: dto.activityId, editedAt: new Date() }, include: this.include() });
      return updated;
    }).then((updated) => {
      if (taggedUserIds !== undefined) this.notifyTaggedUsers(userId, id, taggedUserIds.filter((taggedUserId) => !post.taggedUsers.some((tag) => tag.userId === taggedUserId)));
      return this.presentPost(updated);
    });
  }

  async postHistory(userId: string, postId: string) {
    await this.ensureCanViewPost(userId, postId);
    return this.prisma.postEditHistory.findMany({ where: { postId }, orderBy: { createdAt: 'desc' } });
  }

  async save(userId: string, postId: string) {
    await this.ensureCanViewPost(userId, postId);
    return this.prisma.postSave.upsert({ where: { postId_userId: { postId, userId } }, create: { postId, userId }, update: {} }).then(() => ({ saved: true }));
  }

  unsave(userId: string, postId: string) {
    return this.prisma.postSave.delete({ where: { postId_userId: { postId, userId } } }).catch(() => null).then(() => ({ saved: false }));
  }

  async repost(userId: string, postId: string, dto: RepostDto) {
    await this.ensureCanViewPost(userId, postId);
    const repost = await this.prisma.repost.create({
      data: { postId, userId, text: dto.text?.trim() },
      include: { post: { include: this.include() }, user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } },
    });
    void this.notifications.create({ userId: repost.post.authorId, actorId: userId, type: 'repost', entityId: repost.id, message: 'Someone reposted your post.' });
    return repost;
  }

  async likeRepost(userId: string, repostId: string) {
    const repost = await this.prisma.repost.findUniqueOrThrow({ where: { id: repostId }, select: { userId: true, postId: true } });
    await this.ensureCanViewPost(userId, repost.postId);
    const existing = await this.prisma.repostLike.findUnique({ where: { repostId_userId: { repostId, userId } } });
    if (!existing) {
      await this.prisma.repostLike.create({ data: { repostId, userId } });
      await this.prisma.repost.update({ where: { id: repostId }, data: { likeCount: { increment: 1 } } });
      void this.notifications.create({ userId: repost.userId, actorId: userId, type: 'repost_like', entityId: repostId, message: 'Someone saluted your repost.' });
    }
    return { liked: true };
  }

  async unlikeRepost(userId: string, repostId: string) {
    const deleted = await this.prisma.repostLike.delete({ where: { repostId_userId: { repostId, userId } } }).then(() => true).catch(() => false);
    if (deleted) await this.prisma.repost.update({ where: { id: repostId }, data: { likeCount: { decrement: 1 } } }).catch(() => null);
    return { liked: false };
  }

  hide(userId: string, postId: string) {
    return this.prisma.hiddenPost.upsert({ where: { postId_userId: { postId, userId } }, create: { postId, userId }, update: {} }).then(() => ({ hidden: true }));
  }

  async pin(userId: string, id: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id }, select: { authorId: true } });
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can pin this post');
    return this.prisma.post.update({ where: { id }, data: { pinnedAt: new Date() }, include: this.include() }).then((post) => this.presentPost(post));
  }

  async unpin(userId: string, id: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id }, select: { authorId: true } });
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can unpin this post');
    return this.prisma.post.update({ where: { id }, data: { pinnedAt: null }, include: this.include() }).then((post) => this.presentPost(post));
  }

  async report(userId: string, postId: string, dto: ReportPostDto) {
    await this.ensureCanViewPost(userId, postId);
    const reason = dto.reason ?? 'other';
    return this.prisma.postReport.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, reason, note: dto.note?.trim() },
      update: { reason, note: dto.note?.trim() },
    }).then(() => ({ ok: true }));
  }

  async like(userId: string, postId: string) {
    await this.ensureCanViewPost(userId, postId);
    const existing = await this.prisma.postLike.findUnique({ where: { postId_userId: { postId, userId } } });
    if (!existing) {
      await this.prisma.postLike.create({ data: { postId, userId } });
      const post = await this.prisma.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } }, select: { authorId: true } }).catch(() => null);
      if (post) void this.notifications.create({ userId: post.authorId, actorId: userId, type: 'salute', entityId: postId, message: 'Someone saluted your post.' });
    }
    return { liked: true };
  }

  async unlike(userId: string, postId: string) {
    const deleted = await this.prisma.postLike.delete({ where: { postId_userId: { postId, userId } } }).then(() => true).catch(() => false);
    if (deleted) await this.prisma.post.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } }).catch(() => null);
    return { liked: false };
  }

  async comments(postId: string, filters: { sort?: 'top' | 'newest' | 'oldest'; take?: number; cursor?: number } = {}, viewerId?: string) {
    if (viewerId) await this.ensureCanViewPost(viewerId, postId);
    const take = Math.min(Math.max(filters.take ?? 10, 1), 50);
    const cursor = Math.max(filters.cursor ?? 0, 0);
    const comments = await this.prisma.comment.findMany({
      where: { postId, parentId: null },
      orderBy: this.commentOrderBy(filters.sort),
      include: this.commentInclude(undefined, viewerId),
      skip: cursor,
      take: take + 1,
    });
    const items = comments.slice(0, take);
    return {
      items: this.decorateCommentOwnership(items, viewerId),
      nextCursor: comments.length > take ? cursor + take : null,
    };
  }

  async comment(userId: string, postId: string, dto: CommentDto) {
    await this.ensureCanViewPost(userId, postId);
    const body = dto.body?.trim() ?? '';
    const images = (dto.images ?? []).slice(0, 1);
    if (!body && !images.length) throw new BadRequestException('Comment cannot be empty');
    let parentId = dto.parentId;
    let notifyParentId = dto.parentId;
    if (dto.parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: dto.parentId }, select: { id: true, postId: true, parentId: true } });
      if (!parent || parent.postId !== postId) throw new BadRequestException('Reply target is invalid');
      parentId = parent.parentId ?? parent.id;
      notifyParentId = parent.id;
    }
    const comment = await this.prisma.comment.create({
      data: {
        postId,
        authorId: userId,
        parentId,
        body,
        images: { create: images.map((image, index) => ({ url: image.url, alt: image.alt, filename: image.filename, mimeType: image.mimeType, size: image.size ? Math.round(image.size) : undefined, width: image.width ? Math.round(image.width) : undefined, height: image.height ? Math.round(image.height) : undefined, sortOrder: index })) },
      },
      include: this.commentInclude(),
    });
    const post = await this.prisma.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } }, select: { authorId: true } }).catch(() => null);
    if (post) {
      if (notifyParentId) {
        const parent = await this.prisma.comment.findUnique({ where: { id: notifyParentId }, select: { authorId: true } });
        if (parent) void this.notifications.create({ userId: parent.authorId, actorId: userId, type: 'reply', entityId: postId, message: 'Someone replied to your comment.' });
      } else {
        void this.notifications.create({ userId: post.authorId, actorId: userId, type: 'comment', entityId: postId, message: 'Someone commented on your post.' });
      }
      await this.notifyMentionedUsers(userId, postId, body, 'Someone mentioned you in a comment.');
    }
    return comment;
  }


  async updateComment(userId: string, postId: string, commentId: string, dto: UpdateCommentDto) {
    const comment = await this.prisma.comment.findUniqueOrThrow({ where: { id: commentId }, select: { authorId: true, postId: true, body: true } });
    if (comment.postId !== postId) throw new BadRequestException('Comment does not belong to this post');
    if (comment.authorId !== userId) throw new ForbiddenException('Only the comment author can edit this comment');
    const newBody = dto.body.trim();
    return this.prisma.$transaction(async (tx) => {
      if (comment.body !== newBody) {
        await tx.commentEditHistory.create({ data: { commentId, editorId: userId, oldBody: comment.body, newBody } });
      }
      return tx.comment.update({ where: { id: commentId }, data: { body: newBody, editedAt: new Date() }, include: this.commentInclude() });
    });
  }

  async commentHistory(userId: string, postId: string, commentId: string) {
    await this.ensureCanViewPost(userId, postId);
    const comment = await this.prisma.comment.findUniqueOrThrow({ where: { id: commentId }, select: { postId: true } });
    if (comment.postId !== postId) throw new BadRequestException('Comment does not belong to this post');
    return this.prisma.commentEditHistory.findMany({ where: { commentId }, orderBy: { createdAt: 'desc' } });
  }

  async likeComment(userId: string, postId: string, commentId: string) {
    await this.ensureCanViewPost(userId, postId);
    const comment = await this.prisma.comment.findUniqueOrThrow({ where: { id: commentId }, select: { postId: true, authorId: true } });
    if (comment.postId !== postId) throw new BadRequestException('Comment does not belong to this post');
    const existing = await this.prisma.commentLike.findUnique({ where: { commentId_userId: { commentId, userId } } });
    if (!existing) {
      await this.prisma.commentLike.create({ data: { commentId, userId } });
      await this.prisma.comment.update({ where: { id: commentId }, data: { likeCount: { increment: 1 } } });
    }
    return { liked: true };
  }

  async unlikeComment(userId: string, postId: string, commentId: string) {
    const comment = await this.prisma.comment.findUniqueOrThrow({ where: { id: commentId }, select: { postId: true } });
    if (comment.postId !== postId) throw new BadRequestException('Comment does not belong to this post');
    const deleted = await this.prisma.commentLike.delete({ where: { commentId_userId: { commentId, userId } } }).then(() => true).catch(() => false);
    if (deleted) await this.prisma.comment.update({ where: { id: commentId }, data: { likeCount: { decrement: 1 } } });
    return { liked: false };
  }

  async removeComment(userId: string, postId: string, commentId: string) {
    const comment = await this.prisma.comment.findUniqueOrThrow({
      where: { id: commentId },
      select: { authorId: true, postId: true },
    });
    if (comment.postId !== postId) throw new BadRequestException('Comment does not belong to this post');
    if (comment.authorId !== userId) throw new ForbiddenException('Only the comment author can delete this comment');
    const deletedCount = await this.countCommentTree(commentId);
    await this.prisma.comment.delete({ where: { id: commentId } });
    await this.prisma.post.update({ where: { id: postId }, data: { commentCount: { decrement: deletedCount } } }).catch(() => null);
  }

  private async ensureCanViewPost(userId: string, postId: string) {
    await assertCanViewPost(this.prisma, userId, postId);
  }

  private async ensureCanPostOnProfile(authorId: string, profileOwnerId: string) {
    const profileOwner = await this.prisma.user.findFirst({
      where: { id: profileOwnerId, ...visibleAuthorWhere(authorId) },
      select: { id: true },
    });
    if (!profileOwner) throw new ForbiddenException('You cannot post on this profile');
  }

  private async countCommentTree(commentId: string): Promise<number> {
    const replies = await this.prisma.comment.findMany({ where: { parentId: commentId }, select: { id: true } });
    let total = 1;
    for (const reply of replies) total += await this.countCommentTree(reply.id);
    return total;
  }

  private commentInclude(replyTake?: number, viewerId?: string) {
    const viewerLikes = viewerId ? { likes: { where: { userId: viewerId }, select: { userId: true } } } : {};
    return {
      author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      images: { orderBy: { sortOrder: 'asc' as const } },
      ...viewerLikes,
      replies: {
        ...(replyTake ? { take: replyTake } : {}),
        where: { parentId: { not: null } },
        orderBy: { createdAt: 'asc' as const },
        include: {
          author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
          images: { orderBy: { sortOrder: 'asc' as const } },
          ...viewerLikes,
        },
      },
    };
  }

  private commentOrderBy(sort: 'top' | 'newest' | 'oldest' = 'top') {
    if (sort === 'oldest') return [{ createdAt: 'asc' as const }];
    if (sort === 'newest') return [{ createdAt: 'desc' as const }];
    return [{ likeCount: 'desc' as const }, { replies: { _count: 'desc' as const } }, { createdAt: 'desc' as const }];
  }

  private decorateCommentOwnership<T extends { authorId: string; replies?: Array<{ authorId: string }> }>(comments: T[], viewerId?: string): (T & { viewerCanManage: boolean })[] {
    return comments.map((comment) => ({
      ...comment,
      viewerCanManage: Boolean(viewerId && comment.authorId === viewerId),
      replies: comment.replies?.map((reply) => ({ ...reply, viewerCanManage: Boolean(viewerId && reply.authorId === viewerId) })),
    }));
  }

  private extractMentions(text: string) { return [...text.matchAll(/@([\p{L}\p{N}._-]+)/gu)].map((m) => m[1]).filter(Boolean); }

  private async notifyMentionedUsers(actorId: string, postId: string, text: string, message: string) {
    const mentions = [...new Set(this.extractMentions(text))];
    if (!mentions.length) return;
    const users = await this.prisma.user.findMany({
      where: { OR: mentions.map((mention) => ({ username: { equals: mention, mode: 'insensitive' as const } })) },
      select: { id: true },
    });
    for (const user of users) void this.notifications.create({ userId: user.id, actorId, type: 'mention', entityId: postId, message });
  }
  private extractHashtags(text?: string) { return text?.match(/#[\p{L}\p{N}_]+/gu) ?? []; }
  private taggedUserIds(dto: Pick<CreatePostDto, 'taggedUserIds' | 'taggedUsers'>) {
    const ids = dto.taggedUserIds ?? dto.taggedUsers;
    if (ids === undefined) return undefined;
    return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  }

  private async validateTaggedUsers(actorId: string, taggedUserIds?: string[]) {
    const uniqueIds = [...new Set(taggedUserIds ?? [])].filter(Boolean);
    if (!uniqueIds.length) return [];
    const visibleUsers = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, ...visibleAuthorWhere(actorId) },
      select: { id: true },
    });
    const visibleIds = new Set(visibleUsers.map((user) => user.id));
    const invalidIds = uniqueIds.filter((id) => !visibleIds.has(id));
    if (invalidIds.length) throw new BadRequestException('One or more tagged users cannot be tagged');
    return uniqueIds;
  }

  private async ensureOwnsActivity(userId: string, activityId: string) {
    const activity = await this.prisma.activity.findFirst({ where: { id: activityId, userId }, select: { id: true } });
    if (!activity) throw new BadRequestException('Activity cannot be attached to this post');
  }

  private notifyTaggedUsers(actorId: string, postId: string, taggedUserIds: string[]) {
    for (const userId of taggedUserIds) void this.notifications.create({ userId, actorId, type: 'mention', entityId: postId, message: 'tagged you in a post.' });
  }

  private presentPost<T extends { _count?: { reposts?: number } | null; author?: Record<string, unknown> | null }>(post: T) {
    const { _count, ...rest } = { ...post } as T & { latitude?: unknown; longitude?: unknown };
    delete rest.latitude;
    delete rest.longitude;
    const author = rest.author ? { ...rest.author } : rest.author;
    if (author) {
      delete author.latitude;
      delete author.longitude;
    }
    return {
      ...rest,
      author,
      repostCount: _count?.reposts ?? 0,
    };
  }

  private include(viewerId?: string) {
    return {
      author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      profileOwner: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      activity: { select: this.activitySelect() },
      group: { select: { id: true, name: true, slug: true, visibility: true } },
      images: { orderBy: { sortOrder: 'asc' as const } },
      hashtags: { include: { hashtag: true } },
      taggedUsers: { include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } }, orderBy: { createdAt: 'asc' as const } },
      comments: { take: 2, where: { parentId: null }, orderBy: { createdAt: 'desc' as const }, include: this.commentInclude(1, viewerId) },
      _count: { select: { reposts: true } },
      ...(viewerId ? { saves: { where: { userId: viewerId }, select: { userId: true } } } : {}),
    };
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
}
