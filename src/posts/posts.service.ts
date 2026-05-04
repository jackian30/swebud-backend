import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CommentDto, CreatePostDto, ReportPostDto, RepostDto, UpdateCommentDto, UpdatePostDto } from './dto';

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  create(authorId: string, dto: CreatePostDto) {
    if (!dto.text?.trim() && !dto.images?.length) throw new BadRequestException('Post needs text or at least one image');
    const hashtags = [...new Set((dto.hashtags ?? this.extractHashtags(dto.text)).map((t) => t.toLowerCase().replace(/^#/, '').trim()).filter(Boolean))];
    return this.prisma.post.create({
      data: {
        authorId,
        text: dto.text?.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        images: { create: (dto.images ?? []).map((image, sortOrder) => ({ ...image, sortOrder })) },
        hashtags: { create: hashtags.map((name) => ({ hashtag: { connectOrCreate: { where: { name }, create: { name } } } })) },
      },
      include: this.include(),
    });
  }

  list(take = 20, cursor?: string) {
    return this.prisma.post.findMany({
      take: Math.min(take, 50),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: this.include(),
    });
  }

  async get(id: string, viewerId?: string) {
    if (viewerId) await this.ensureCanViewPost(viewerId, id);
    await this.prisma.post.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => null);
    return this.prisma.post.findUniqueOrThrow({ where: { id }, include: this.include(viewerId) });
  }

  async remove(userId: string, id: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id }, select: { authorId: true } });
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can delete this post');
    await this.prisma.post.delete({ where: { id } });
  }


  async update(userId: string, id: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id }, select: { authorId: true } });
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can edit this post');
    return this.prisma.post.update({ where: { id }, data: { text: dto.text?.trim(), editedAt: new Date() }, include: this.include() });
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
    return this.prisma.repost.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, text: dto.text?.trim() },
      update: { text: dto.text?.trim() },
      include: { post: { include: this.include() }, user: { select: { id: true, displayName: true } } },
    });
  }

  hide(userId: string, postId: string) {
    return this.prisma.hiddenPost.upsert({ where: { postId_userId: { postId, userId } }, create: { postId, userId }, update: {} }).then(() => ({ hidden: true }));
  }

  async pin(userId: string, id: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id }, select: { authorId: true } });
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can pin this post');
    return this.prisma.post.update({ where: { id }, data: { pinnedAt: new Date() }, include: this.include() });
  }

  async unpin(userId: string, id: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id }, select: { authorId: true } });
    if (post.authorId !== userId) throw new ForbiddenException('Only the author can unpin this post');
    return this.prisma.post.update({ where: { id }, data: { pinnedAt: null }, include: this.include() });
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

  async comments(postId: string, sort: 'top' | 'newest' | 'oldest' = 'top', viewerId?: string) {
    if (viewerId) await this.ensureCanViewPost(viewerId, postId);
    return this.prisma.comment.findMany({
      where: { postId, parentId: null },
      orderBy: sort === 'oldest' ? { createdAt: 'asc' } : { createdAt: 'desc' },
      include: this.commentInclude(),
    });
  }

  async comment(userId: string, postId: string, dto: CommentDto) {
    await this.ensureCanViewPost(userId, postId);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Comment cannot be empty');
    if (dto.parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: dto.parentId }, select: { postId: true } });
      if (!parent || parent.postId !== postId) throw new BadRequestException('Reply target is invalid');
    }
    const comment = await this.prisma.comment.create({ data: { postId, authorId: userId, parentId: dto.parentId, body }, include: this.commentInclude() });
    const post = await this.prisma.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } }, select: { authorId: true } }).catch(() => null);
    if (post) {
      if (dto.parentId) {
        const parent = await this.prisma.comment.findUnique({ where: { id: dto.parentId }, select: { authorId: true } });
        if (parent) void this.notifications.create({ userId: parent.authorId, actorId: userId, type: 'reply', entityId: postId, message: 'Someone replied to your comment.' });
      } else {
        void this.notifications.create({ userId: post.authorId, actorId: userId, type: 'comment', entityId: postId, message: 'Someone commented on your post.' });
      }
      for (const mention of this.extractMentions(body)) {
        const mentioned = await this.prisma.user.findFirst({ where: { OR: [{ username: { equals: mention, mode: 'insensitive' } }, { displayName: { equals: mention, mode: 'insensitive' } }] }, select: { id: true } });
        if (mentioned) void this.notifications.create({ userId: mentioned.id, actorId: userId, type: 'mention', entityId: postId, message: 'Someone mentioned you in a comment.' });
      }
    }
    return comment;
  }


  async updateComment(userId: string, postId: string, commentId: string, dto: UpdateCommentDto) {
    const comment = await this.prisma.comment.findUniqueOrThrow({ where: { id: commentId }, select: { authorId: true, postId: true } });
    if (comment.postId !== postId) throw new BadRequestException('Comment does not belong to this post');
    if (comment.authorId !== userId) throw new ForbiddenException('Only the comment author can edit this comment');
    return this.prisma.comment.update({ where: { id: commentId }, data: { body: dto.body.trim(), editedAt: new Date() }, include: this.commentInclude() });
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
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { group: { select: { visibility: true, members: { where: { userId }, select: { userId: true } } } } } });
    if (post.group?.visibility === 'private' && post.group.members.length === 0) throw new ForbiddenException('Join this private group by invite first');
  }

  private async countCommentTree(commentId: string): Promise<number> {
    const replies = await this.prisma.comment.findMany({ where: { parentId: commentId }, select: { id: true } });
    let total = 1;
    for (const reply of replies) total += await this.countCommentTree(reply.id);
    return total;
  }

  private commentInclude(replyTake?: number) {
    return {
      author: { select: { id: true, displayName: true, username: true } },
      replies: {
        take: replyTake ?? 50,
        orderBy: { createdAt: 'asc' as const },
        include: {
          author: { select: { id: true, displayName: true, username: true } },
          replies: {
            take: 50,
            orderBy: { createdAt: 'asc' as const },
            include: {
              author: { select: { id: true, displayName: true, username: true } },
              replies: {
                take: 50,
                orderBy: { createdAt: 'asc' as const },
                include: { author: { select: { id: true, displayName: true, username: true } } },
              },
            },
          },
        },
      },
    };
  }

  private extractMentions(text: string) { return [...text.matchAll(/@([\p{L}\p{N}._-]+)/gu)].map((m) => m[1]).filter(Boolean); }
  private extractHashtags(text?: string) { return text?.match(/#[\p{L}\p{N}_]+/gu) ?? []; }
  private include(viewerId?: string) {
    return {
      author: { select: { id: true, displayName: true, username: true, profileImageUrl: true, latitude: true, longitude: true } },
      group: { select: { id: true, name: true, slug: true, visibility: true } },
      images: { orderBy: { sortOrder: 'asc' as const } },
      hashtags: { include: { hashtag: true } },
      comments: { take: 2, where: { parentId: null }, orderBy: { createdAt: 'desc' as const }, include: this.commentInclude(1) },
      ...(viewerId ? { saves: { where: { userId: viewerId }, select: { userId: true } } } : {}),
    };
  }
}
