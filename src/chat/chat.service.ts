import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessageReactionDto, RegisterChatKeyDto, SendDirectMessageDto, UpdateChatProfileDto } from './dto';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  registerKey(userId: string, dto: RegisterChatKeyDto) {
    return this.prisma.user.update({ where: { id: userId }, data: { chatPublicKey: dto.publicKey }, select: { id: true, chatPublicKey: true } });
  }

  peerKey(peerId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: peerId }, select: { id: true, chatPublicKey: true } });
  }

  async buddyProfile(userId: string, peerId: string) {
    if (userId === peerId) throw new BadRequestException('Cannot customize a chat with yourself');
    const [peer, override] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: peerId }, select: { id: true, displayName: true, username: true, profileImageUrl: true } }),
      this.prisma.chatProfileOverride.findUnique({ where: { ownerId_peerId: { ownerId: userId, peerId } } }),
    ]);
    return { peer, override };
  }

  async updateBuddyProfile(userId: string, peerId: string, dto: UpdateChatProfileDto) {
    if (userId === peerId) throw new BadRequestException('Cannot customize a chat with yourself');
    await this.prisma.user.findUniqueOrThrow({ where: { id: peerId }, select: { id: true } });
    const displayName = dto.displayName?.trim() || null;
    const profileImageUrl = dto.profileImageUrl?.trim() || null;
    return this.prisma.chatProfileOverride.upsert({
      where: { ownerId_peerId: { ownerId: userId, peerId } },
      create: { ownerId: userId, peerId, displayName, profileImageUrl },
      update: { displayName, profileImageUrl },
    });
  }

  async send(senderId: string, dto: SendDirectMessageDto) {
    if (senderId === dto.recipientId) throw new BadRequestException('Cannot message yourself');
    await this.ensureMutual(senderId, dto.recipientId);
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
    if (senderId === dto.recipientId) throw new BadRequestException('Cannot message yourself');
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

  async react(userId: string, messageId: string, dto: MessageReactionDto) {
    const emoji = this.allowedReaction(dto.emoji);
    await this.ensureCanAccessMessage(userId, messageId);
    await this.prisma.$transaction([
      this.prisma.messageReaction.deleteMany({ where: { messageId, userId } }),
      this.prisma.messageReaction.create({ data: { messageId, userId, emoji } }),
    ]);
    return this.message(messageId);
  }

  async unreact(userId: string, messageId: string, emoji: string) {
    await this.ensureCanAccessMessage(userId, messageId);
    await this.prisma.messageReaction.deleteMany({ where: { messageId, userId, emoji } });
    return this.message(messageId);
  }

  private message(messageId: string) {
    return this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: this.messageInclude() });
  }

  private allowedReaction(emoji: string) {
    const value = emoji.trim();
    const Segmenter = (Intl as typeof Intl & {
      Segmenter: new (locale?: string, options?: { granularity: 'grapheme' }) => {
        segment(input: string): Iterable<{ segment: string }>;
      };
    }).Segmenter;
    const segments = [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
    const hasDisplayEmoji = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\uFE0F\u20E3]/u.test(value);
    if (!value || segments.length !== 1 || !hasDisplayEmoji) throw new BadRequestException('Unsupported reaction');
    return value;
  }

  private async ensureCanAccessMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { senderId: true, recipientId: true, groupId: true } });
    if (!message.groupId) {
      if (message.senderId !== userId && message.recipientId !== userId) throw new ForbiddenException();
      return message;
    }
    const member = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: message.groupId, userId } }, select: { userId: true } });
    if (!member) throw new ForbiddenException();
    return message;
  }

  private async ensureMutual(userId: string, peerId: string) {
    const [following, followsMe] = await Promise.all([
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: peerId } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: peerId, followingId: userId } } }),
    ]);
    if (!following || !followsMe) throw new ForbiddenException('Send a message request first.');
  }

  private messageInclude() { return { sender: { select: { id: true, displayName: true, profileImageUrl: true } }, recipient: { select: { id: true, displayName: true, profileImageUrl: true } }, reactions: true } as const; }
  private requestInclude() { return { sender: { select: { id: true, displayName: true, username: true, bio: true, profileImageUrl: true, chatPublicKey: true } }, recipient: { select: { id: true, displayName: true, username: true, profileImageUrl: true, chatPublicKey: true } } } as const; }
}
