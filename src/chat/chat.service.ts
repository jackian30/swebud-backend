import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AddBuddyGroupParticipantsDto, CreateBuddyGroupChatDto, MessageReactionDto, RegisterChatKeyDto, SendBuddyGroupMessageDto, SendDirectMessageDto, UpdateChatProfileDto } from './dto';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  registerKey(userId: string, dto: RegisterChatKeyDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { chatPublicKey: dto.publicKey, ...(dto.privateKey ? { chatPrivateKey: dto.privateKey } : {}) },
      select: { id: true, chatPublicKey: true, chatPrivateKey: true },
    });
  }

  myKey(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, chatPublicKey: true, chatPrivateKey: true } });
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

  async send(senderId: string, dto: SendDirectMessageDto, trustedReference = false) {
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
        ...this.referenceData(dto, trustedReference),
      },
      include: this.messageInclude(),
    });
  }

  async request(senderId: string, dto: SendDirectMessageDto, trustedReference = false) {
    if (senderId === dto.recipientId) throw new BadRequestException('Cannot message yourself');
    if (await this.isMutual(senderId, dto.recipientId)) return this.send(senderId, dto, trustedReference);
    const request = await this.prisma.messageRequest.create({ data: { senderId, recipientId: dto.recipientId, body: dto.encrypted ? '[encrypted request]' : dto.body.trim(), ...this.referenceData(dto, trustedReference) }, include: this.requestInclude() });
    void this.notifications.create({ userId: dto.recipientId, actorId: senderId, type: 'message_request', entityId: request.id, message: 'sent you a message request' });
    return request;
  }

  async requests(userId: string) {
    await this.acceptMutualRequests(userId);
    return this.prisma.messageRequest.findMany({ where: { recipientId: userId, status: 'pending' }, orderBy: { createdAt: 'desc' }, include: this.requestInclude() });
  }

  async accept(userId: string, id: string) { const req = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id } }); if (req.recipientId !== userId) throw new ForbiddenException(); await this.prisma.message.create({ data: { senderId: req.senderId, recipientId: req.recipientId, body: req.body, referenceType: req.referenceType, referenceId: req.referenceId, referenceMediaUrl: req.referenceMediaUrl, referenceText: req.referenceText, referenceAuthorName: req.referenceAuthorName } }); return this.prisma.messageRequest.update({ where: { id }, data: { status: 'accepted' }, include: this.requestInclude() }); }
  async decline(userId: string, id: string) { const req = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id } }); if (req.recipientId !== userId) throw new ForbiddenException(); return this.prisma.messageRequest.update({ where: { id }, data: { status: 'declined' }, include: this.requestInclude() }); }

  conversation(userId: string, peerId: string) {
    return this.prisma.message.findMany({ where: { groupId: null, OR: [{ senderId: userId, recipientId: peerId }, { senderId: peerId, recipientId: userId }] }, orderBy: { createdAt: 'asc' }, include: this.messageInclude() });
  }

  async conversations(userId: string) {
    await this.acceptMutualRequests(userId);
    const [mutualFollows, directMessages] = await Promise.all([
      this.prisma.follow.findMany({
        where: {
          followerId: userId,
          following: { following: { some: { followingId: userId } } },
        },
        include: { following: { select: this.chatPeerSelect() } },
      }),
      this.prisma.message.findMany({
        where: { groupId: null, OR: [{ senderId: userId }, { recipientId: userId }] },
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: this.messageInclude(),
      }),
    ]);
    const peers = new Map<string, any>();
    for (const follow of mutualFollows) peers.set(follow.following.id, follow.following);
    for (const message of directMessages) {
      const peer = message.senderId === userId ? message.recipient : message.sender;
      if (peer?.id) peers.set(peer.id, peer);
    }
    const peerList = [...peers.values()];
    const peerIds = peerList.map((peer) => peer.id).filter(Boolean);
    const unreadBySender = new Map<string, number>();
    if (peerIds.length) {
      const unreadRows = await this.prisma.message.groupBy({
        by: ['senderId'],
        where: { groupId: null, senderId: { in: peerIds }, recipientId: userId, readAt: null },
        _count: { _all: true },
      });
      for (const row of unreadRows) unreadBySender.set(row.senderId, row._count._all);
    }
    const summaries = peerList.map((peer) => {
      const lastMessage = directMessages.find((message) => message.senderId === peer.id || message.recipientId === peer.id) ?? null;
      const unreadCount = unreadBySender.get(peer.id) ?? 0;
      return { peer, lastMessage, unreadCount };
    });
    return summaries.sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      return new Date(b.lastMessage?.createdAt ?? 0).getTime() - new Date(a.lastMessage?.createdAt ?? 0).getTime();
    });
  }

  async buddyGroupChats(userId: string) {
    const rooms = await this.prisma.buddyGroupChat.findMany({
      where: { members: { some: { userId } } },
      orderBy: { updatedAt: 'desc' },
      include: this.buddyGroupInclude(),
    });
    return rooms.map((room) => this.withLastBuddyGroupMessage(room));
  }

  async buddyGroupChat(userId: string, id: string) {
    await this.ensureBuddyGroupMember(userId, id);
    return this.withLastBuddyGroupMessage(await this.prisma.buddyGroupChat.findUniqueOrThrow({ where: { id }, include: this.buddyGroupInclude() }));
  }

  async createBuddyGroupChat(userId: string, dto: CreateBuddyGroupChatDto) {
    const participantIds = this.uniqueParticipantIds(userId, dto.participantIds);
    await this.ensureUsersExist(participantIds);
    const room = await this.prisma.buddyGroupChat.create({
      data: {
        creatorId: userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        members: { create: participantIds.map((participantId) => ({ userId: participantId, addedById: userId })) },
      },
      include: this.buddyGroupInclude(),
    });
    return this.withLastBuddyGroupMessage(room);
  }

  async addBuddyGroupParticipants(userId: string, id: string, dto: AddBuddyGroupParticipantsDto) {
    await this.ensureBuddyGroupMember(userId, id);
    const participantIds = this.uniqueParticipantIds(userId, dto.participantIds);
    await this.ensureUsersExist(participantIds);
    await this.prisma.$transaction(participantIds.map((participantId) => this.prisma.buddyGroupChatMember.upsert({
      where: { buddyGroupChatId_userId: { buddyGroupChatId: id, userId: participantId } },
      create: { buddyGroupChatId: id, userId: participantId, addedById: userId },
      update: {},
    })));
    return this.buddyGroupChat(userId, id);
  }

  async buddyGroupMessages(userId: string, id: string) {
    await this.ensureBuddyGroupMember(userId, id);
    return this.prisma.message.findMany({ where: { buddyGroupChatId: id }, orderBy: { createdAt: 'asc' }, include: this.messageInclude() });
  }

  async sendBuddyGroupMessage(userId: string, id: string, dto: SendBuddyGroupMessageDto) {
    await this.ensureBuddyGroupMember(userId, id);
    const message = await this.prisma.message.create({
      data: { senderId: userId, buddyGroupChatId: id, body: dto.body.trim() },
      include: this.messageInclude(),
    });
    await this.prisma.buddyGroupChat.update({ where: { id }, data: { updatedAt: new Date() } });
    return message;
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
    const target = await this.ensureCanAccessMessage(userId, messageId);
    await this.prisma.$transaction([
      this.prisma.messageReaction.deleteMany({ where: { messageId, userId } }),
      this.prisma.messageReaction.create({ data: { messageId, userId, emoji } }),
    ]);
    if (target.senderId !== userId) {
      void this.notifications.create({
        userId: target.senderId,
        actorId: userId,
        type: 'message_reaction',
        entityId: messageId,
        message: 'reacted to your message',
      });
    }
    return this.message(messageId);
  }

  async unreact(userId: string, messageId: string, emoji: string) {
    await this.ensureCanAccessMessage(userId, messageId);
    await this.prisma.messageReaction.deleteMany({ where: { messageId, userId, emoji } });
    return this.message(messageId);
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.ensureCanAccessMessage(userId, messageId);
    if (message.senderId !== userId) throw new ForbiddenException('Only the sender can delete this message');
    const deletedAt = new Date();
    await this.prisma.messageReaction.deleteMany({ where: { messageId } });
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        body: '',
        referenceType: null,
        referenceId: null,
        referenceMediaUrl: null,
        referenceText: null,
        referenceAuthorName: null,
        ciphertext: null,
        nonce: null,
        encrypted: false,
        deletedAt,
        deletedById: userId,
      },
      include: this.messageInclude(),
    });
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
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { senderId: true, recipientId: true, groupId: true, buddyGroupChatId: true } });
    if (message.buddyGroupChatId) {
      await this.ensureBuddyGroupMember(userId, message.buddyGroupChatId);
      return message;
    }
    if (!message.groupId) {
      if (message.senderId !== userId && message.recipientId !== userId) throw new ForbiddenException();
      return message;
    }
    const member = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: message.groupId, userId } }, select: { userId: true } });
    if (!member) throw new ForbiddenException();
    return message;
  }

  private async ensureCanAccessDirectMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { senderId: true, recipientId: true, groupId: true, buddyGroupChatId: true } });
    if (message.groupId || message.buddyGroupChatId || !message.recipientId) throw new ForbiddenException('Direct message only');
    if (message.senderId !== userId && message.recipientId !== userId) throw new ForbiddenException();
    return message;
  }

  private async ensureMutual(userId: string, peerId: string) {
    if (!(await this.isMutual(userId, peerId))) throw new ForbiddenException('Send a message request first.');
  }

  private async isMutual(userId: string, peerId: string) {
    const [following, followsMe] = await Promise.all([
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: peerId } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: peerId, followingId: userId } } }),
    ]);
    return Boolean(following && followsMe);
  }

  private async acceptMutualRequests(userId: string) {
    const pending = await this.prisma.messageRequest.findMany({
      where: { recipientId: userId, status: 'pending' },
      select: { id: true, senderId: true, recipientId: true, body: true, referenceType: true, referenceId: true, referenceMediaUrl: true, referenceText: true, referenceAuthorName: true },
    });
    const mutualRequests = [];
    for (const request of pending) {
      if (await this.isMutual(request.senderId, request.recipientId)) mutualRequests.push(request);
    }
    await Promise.all(mutualRequests.map((request) => this.prisma.$transaction([
      this.prisma.message.create({ data: { senderId: request.senderId, recipientId: request.recipientId, body: request.body, referenceType: request.referenceType, referenceId: request.referenceId, referenceMediaUrl: request.referenceMediaUrl, referenceText: request.referenceText, referenceAuthorName: request.referenceAuthorName } }),
      this.prisma.messageRequest.update({ where: { id: request.id }, data: { status: 'accepted' }, include: this.requestInclude() }),
    ])));
  }

  private async ensureBuddyGroupMember(userId: string, buddyGroupChatId: string) {
    const member = await this.prisma.buddyGroupChatMember.findUnique({ where: { buddyGroupChatId_userId: { buddyGroupChatId, userId } }, select: { userId: true } });
    if (!member) throw new ForbiddenException('You are not in this group buddies chat.');
  }

  private uniqueParticipantIds(userId: string, participantIds: string[]) {
    return [...new Set([userId, ...participantIds.filter((id) => id !== userId)])];
  }

  private async ensureUsersExist(userIds: string[]) {
    const count = await this.prisma.user.count({ where: { id: { in: userIds } } });
    if (count !== userIds.length) throw new BadRequestException('One or more participants were not found.');
  }

  private withLastBuddyGroupMessage(room: any) {
    return { ...room, lastMessage: room.messages?.[0] ?? null, messages: undefined };
  }

  private buddyGroupInclude() {
    return {
      members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: this.chatPeerSelect() } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, include: this.messageInclude() },
      _count: { select: { members: true, messages: true } },
    } as const;
  }

  private messageInclude() { return { sender: { select: { id: true, displayName: true, username: true, profileImageUrl: true } }, recipient: { select: { id: true, displayName: true, username: true, profileImageUrl: true } }, reactions: true } as const; }
  private chatPeerSelect() { return { id: true, displayName: true, username: true, profileImageUrl: true, chatPublicKey: true } as const; }
  private requestInclude() { return { sender: { select: { id: true, displayName: true, username: true, bio: true, profileImageUrl: true, chatPublicKey: true } }, recipient: { select: { id: true, displayName: true, username: true, profileImageUrl: true, chatPublicKey: true } } } as const; }
  private referenceData(dto: SendDirectMessageDto, trustedReference = false) {
    if (!trustedReference) return {};
    return {
      referenceType: dto.referenceType,
      referenceId: dto.referenceId?.trim() || undefined,
      referenceMediaUrl: dto.referenceMediaUrl?.trim() || undefined,
      referenceText: dto.referenceText?.trim() || undefined,
      referenceAuthorName: dto.referenceAuthorName?.trim() || undefined,
    };
  }
}
