import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessageReactionDto, RegisterChatKeyDto, SendDirectMessageDto } from './dto';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  registerKey(userId: string, dto: RegisterChatKeyDto) {
    return this.prisma.user.update({ where: { id: userId }, data: { chatPublicKey: dto.publicKey }, select: { id: true, chatPublicKey: true } });
  }

  peerKey(peerId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: peerId }, select: { id: true, chatPublicKey: true } });
  }

  send(senderId: string, dto: SendDirectMessageDto) {
    return this.prisma.message.create({
      data: {
        senderId,
        recipientId: dto.recipientId,
        body: dto.encrypted ? '[encrypted]' : dto.body.trim(),
        ciphertext: dto.ciphertext,
        nonce: dto.nonce,
        encrypted: Boolean(dto.encrypted),
      },
      include: this.messageInclude(),
    });
  }

  async request(senderId: string, dto: SendDirectMessageDto) {
    const request = await this.prisma.messageRequest.create({ data: { senderId, recipientId: dto.recipientId, body: dto.encrypted ? '[encrypted request]' : dto.body.trim() }, include: this.requestInclude() });
    void this.notifications.create({ userId: dto.recipientId, actorId: senderId, type: 'message_request', entityId: request.id, message: 'sent you a message request' });
    return request;
  }

  requests(userId: string) { return this.prisma.messageRequest.findMany({ where: { recipientId: userId, status: 'pending' }, orderBy: { createdAt: 'desc' }, include: this.requestInclude() }); }

  async accept(userId: string, id: string) { const req = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id } }); if (req.recipientId !== userId) throw new ForbiddenException(); await this.prisma.message.create({ data: { senderId: req.senderId, recipientId: req.recipientId, body: req.body } }); return this.prisma.messageRequest.update({ where: { id }, data: { status: 'accepted' }, include: this.requestInclude() }); }
  async decline(userId: string, id: string) { const req = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id } }); if (req.recipientId !== userId) throw new ForbiddenException(); return this.prisma.messageRequest.update({ where: { id }, data: { status: 'declined' }, include: this.requestInclude() }); }

  conversation(userId: string, peerId: string) {
    return this.prisma.message.findMany({ where: { groupId: null, OR: [{ senderId: userId, recipientId: peerId }, { senderId: peerId, recipientId: userId }] }, orderBy: { createdAt: 'asc' }, include: this.messageInclude() });
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.message.count({ where: { recipientId: userId, readAt: null } });
    return { count };
  }

  async markRead(userId: string, peerId: string) {
    await this.prisma.message.updateMany({ where: { senderId: peerId, recipientId: userId, readAt: null }, data: { readAt: new Date() } });
    return this.unreadCount(userId);
  }

  react(userId: string, messageId: string, dto: MessageReactionDto) {
    return this.prisma.messageReaction.upsert({ where: { messageId_userId_emoji: { messageId, userId, emoji: dto.emoji } }, create: { messageId, userId, emoji: dto.emoji }, update: {} });
  }

  unreact(userId: string, messageId: string, emoji: string) {
    return this.prisma.messageReaction.delete({ where: { messageId_userId_emoji: { messageId, userId, emoji } } }).catch(() => null).then(() => ({ ok: true }));
  }

  private messageInclude() { return { sender: { select: { id: true, displayName: true } }, recipient: { select: { id: true, displayName: true } }, reactions: true } as const; }
  private requestInclude() { return { sender: { select: { id: true, email: true, displayName: true, username: true, bio: true, chatPublicKey: true } }, recipient: { select: { id: true, email: true, displayName: true, chatPublicKey: true } } } as const; }
}
