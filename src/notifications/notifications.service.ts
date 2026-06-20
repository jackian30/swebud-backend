import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

const actorSelect = { id: true, displayName: true, username: true, profileImageUrl: true } as const;
type NotificationActor = { id: string; displayName: string | null; username: string; profileImageUrl: string | null };
type CreateNotificationInput = { userId: string; actorId?: string; type: NotificationType; entityId?: string; message: string };

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService, private gateway: NotificationsGateway) {}

  async create(input: CreateNotificationInput) {
    if (this.isChatNotification(input.type)) return null;
    if (input.actorId && input.actorId === input.userId && input.type !== 'login') return null;
    try {
      const actor = input.actorId ? await this.prisma.user.findUnique({ where: { id: input.actorId }, select: actorSelect }) : null;
      if (this.canAggregate(input)) {
        const existing = await this.prisma.notification.findFirst({
          where: { userId: input.userId, type: input.type, entityId: input.entityId, readAt: null },
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: actorSelect } },
        });
        if (existing) return this.aggregate(existing, input, actor);
      }

      const actorIds = input.actorId ? [input.actorId] : undefined;
      const notification = await this.prisma.notification.create({
        data: {
          ...input,
          actorIds,
          message: this.notificationMessage(input.type, input.message, actor ? [actor] : [], actorIds?.length ?? 0),
        },
        include: { actor: { select: actorSelect } },
      });
      return this.emitNotification(input.userId, notification);
    } catch {
      return null;
    }
  }

  private async aggregate(existing: { id: string; actorId: string | null; actorIds: unknown; actor?: NotificationActor | null }, input: CreateNotificationInput, actor: NotificationActor | null) {
    const actorIds = this.appendActorId(this.actorIds(existing.actorIds, existing.actorId), input.actorId);
    const actors = await this.actorsById(actorIds, actor);
    const notification = await this.prisma.notification.update({
      where: { id: existing.id },
      data: {
        actorId: actorIds[0] ?? existing.actorId,
        actorIds,
        message: this.notificationMessage(input.type, input.message, actors, actorIds.length),
        createdAt: new Date(),
      },
      include: { actor: { select: actorSelect } },
    });
    return this.emitNotification(input.userId, notification);
  }

  private emitNotification<T>(userId: string, notification: T) {
    this.gateway.emitToUser(userId, 'notification:new', notification);
    void this.unreadCount(userId).then((count) => this.gateway.emitToUser(userId, 'notification:unread-count', count));
    return notification;
  }

  private canAggregate(input: CreateNotificationInput) {
    return Boolean(input.actorId && input.entityId && [
      'salute',
      'comment',
      'reply',
      'mention',
      'repost',
      'repost_like',
      'group_join',
    ].includes(input.type));
  }

  private actorIds(value: unknown, fallback?: string | null) {
    const ids = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
    if (!ids.length && fallback) ids.push(fallback);
    return [...new Set(ids)].slice(0, 50);
  }

  private appendActorId(actorIds: string[], actorId?: string) {
    if (!actorId || actorIds.includes(actorId)) return actorIds;
    return [...actorIds, actorId].slice(0, 50);
  }

  private async actorsById(actorIds: string[], actor: NotificationActor | null) {
    const users = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: actorSelect })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    if (actor) byId.set(actor.id, actor);
    return actorIds.map((id) => byId.get(id)).filter((user): user is NotificationActor => Boolean(user));
  }

  private notificationMessage(type: NotificationType, message: string, actors: NotificationActor[], actorCount: number) {
    if (type === 'login' || !actorCount) return message;
    return `${this.actorListLabel(actors, actorCount)} ${this.notificationAction(type, message)}.`;
  }

  private actorListLabel(actors: NotificationActor[], actorCount: number) {
    const names = actors.map((actor) => this.actorName(actor)).filter(Boolean);
    const first = names[0] ?? 'A SweBudd user';
    if (actorCount <= 1) return first;
    const second = names[1] ?? 'another user';
    if (actorCount === 2) return `${first} and ${second}`;
    const others = actorCount - 2;
    return `${first}, ${second}, and ${others} ${others === 1 ? 'other' : 'others'}`;
  }

  private actorName(actor: NotificationActor) {
    const displayName = actor.displayName?.trim();
    if (displayName) return displayName;
    const username = actor.username?.trim();
    if (username) return username.startsWith('@') ? username : `@${username}`;
    return 'A SweBudd user';
  }

  private notificationAction(type: NotificationType, message: string) {
    const cleaned = message
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\.$/, '')
      .replace(/^someone\s+/i, '');
    switch (type) {
      case 'salute':
        return 'saluted your post';
      case 'comment':
        return 'commented on your post';
      case 'reply':
        return 'replied to your comment';
      case 'repost':
        return 'reposted your post';
      case 'repost_like':
        return 'saluted your repost';
      case 'mention':
        if (/tagged/i.test(cleaned)) return 'tagged you in a post';
        if (/comment/i.test(cleaned)) return 'mentioned you in a comment';
        if (/post/i.test(cleaned)) return 'mentioned you in a post';
        return 'mentioned you';
      default:
        return cleaned || 'sent you a notification';
    }
  }

  list(userId: string) {
    return this.prisma.notification.findMany({
      where: this.visibleWhere(userId),
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: actorSelect } },
    });
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { ...this.visibleWhere(userId), readAt: null } });
    return { count };
  }

  markRead(userId: string, id: string) {
    return this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } }).then(() => ({ ok: true }));
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({ where: { ...this.visibleWhere(userId), readAt: null }, data: { readAt: new Date() } }).then(() => ({ ok: true }));
  }

  private visibleWhere(userId: string) {
    return { userId, type: { notIn: ['message_request', 'message_reaction'] as NotificationType[] } };
  }

  private isChatNotification(type: NotificationType) {
    return type === 'message_request' || type === 'message_reaction';
  }
}
