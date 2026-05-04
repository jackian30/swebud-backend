import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService, private gateway: NotificationsGateway) {}

  create(input: { userId: string; actorId?: string; type: NotificationType; entityId?: string; message: string }) {
    if (input.actorId && input.actorId === input.userId && input.type !== 'message_request' && input.type !== 'login') return null;
    return this.prisma.notification.create({ data: input, include: { actor: { select: { id: true, displayName: true, profileImageUrl: true } } } }).then((notification) => {
      this.gateway.emitToUser(input.userId, 'notification:new', notification);
      void this.unreadCount(input.userId).then((count) => this.gateway.emitToUser(input.userId, 'notification:unread-count', count));
      return notification;
    }).catch(() => null);
  }

  list(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: { id: true, displayName: true, profileImageUrl: true } } },
    });
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  markRead(userId: string, id: string) {
    return this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } }).then(() => ({ ok: true }));
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }).then(() => ({ ok: true }));
  }
}
