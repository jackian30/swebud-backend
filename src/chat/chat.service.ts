import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AddBuddyGroupParticipantsDto, ChatHistoryQueryDto, ChatMuteDto, ChatPinDto, CreateBuddyGroupChatDto, MessageReactionDto, RegisterChatKeyDto, ReportMessageDto, SendBuddyGroupMessageDto, SendDirectMessageDto, UpdateChatProfileDto } from './dto';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  registerKey(userId: string, dto: RegisterChatKeyDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { chatPublicKey: dto.publicKey },
      select: { id: true, chatPublicKey: true },
    });
  }

  myKey(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, chatPublicKey: true } });
  }

  async peerKey(userId: string, peerId: string) {
    await this.ensureNotBlocked(userId, peerId);
    return this.prisma.user.findUniqueOrThrow({ where: { id: peerId }, select: { id: true, chatPublicKey: true } });
  }

  async buddyProfile(userId: string, peerId: string) {
    if (userId === peerId) throw new BadRequestException('Cannot customize a chat with yourself');
    await this.ensureNotBlocked(userId, peerId);
    const [peer, override] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: peerId }, select: { id: true, displayName: true, username: true, profileImageUrl: true } }),
      this.prisma.chatProfileOverride.findUnique({ where: { ownerId_peerId: { ownerId: userId, peerId } } }),
    ]);
    return { peer, override };
  }

  async updateBuddyProfile(userId: string, peerId: string, dto: UpdateChatProfileDto) {
    if (userId === peerId) throw new BadRequestException('Cannot customize a chat with yourself');
    await this.ensureNotBlocked(userId, peerId);
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
    await this.assertDirectMessagingAllowed(senderId, dto.recipientId);
    const referenceData = await this.directReferenceData(senderId, dto.recipientId, dto, trustedReference);
    const encryptedPayload = this.directEncryptedPayload(dto);
    const message = await this.prisma.message.create({
      data: {
        senderId,
        recipientId: dto.recipientId,
        ...encryptedPayload,
        ...referenceData,
      },
      include: this.messageInclude(),
    });
    return this.presentMessage(message);
  }

  async request(senderId: string, dto: SendDirectMessageDto, trustedReference = false) {
    if (senderId === dto.recipientId) throw new BadRequestException('Cannot message yourself');
    if (dto.encrypted) throw new BadRequestException('Encrypted message requests are not supported');
    if (typeof dto.body !== 'string' || !dto.body.trim()) throw new BadRequestException('Message cannot be empty');
    await this.ensureNotBlocked(senderId, dto.recipientId);
    if (await this.canSendDirectly(senderId, dto.recipientId)) return this.send(senderId, dto, trustedReference);
    const pendingWhere = this.pendingMessageRequestWhere(senderId, dto.recipientId);
    const existing = await this.prisma.messageRequest.findFirst({ where: pendingWhere, include: this.requestInclude() });
    if (existing) return existing;
    let request;
    try {
      request = await this.prisma.messageRequest.create({ data: { senderId, recipientId: dto.recipientId, body: dto.body.trim(), ...this.referenceData(dto, trustedReference) }, include: this.requestInclude() });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      request = await this.prisma.messageRequest.findFirstOrThrow({ where: pendingWhere, include: this.requestInclude() });
    }
    void this.notifications.create({ userId: dto.recipientId, actorId: senderId, type: 'message_request', entityId: request.id, message: 'sent you a message request' });
    return request;
  }

  async requests(userId: string) {
    return this.prisma.messageRequest.findMany({
      where: {
        recipientId: userId,
        status: 'pending',
        sender: {
          blocksSent: { none: { blockedId: userId } },
          blocksReceived: { none: { blockerId: userId } },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: this.requestInclude(),
    });
  }

  async accept(userId: string, id: string) {
    const request = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id } });
    if (request.recipientId !== userId) throw new ForbiddenException();
    await this.ensureNotBlocked(request.senderId, request.recipientId);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.messageRequest.updateMany({
        where: { id, recipientId: userId, status: 'pending' },
        data: { status: 'accepted' },
      });
      if (claimed.count !== 1) throw new BadRequestException('Message request is no longer pending');
      await tx.message.create({
        data: {
          senderId: request.senderId,
          recipientId: request.recipientId,
          body: request.body,
          referenceType: request.referenceType,
          referenceId: request.referenceId,
          referenceMediaUrl: request.referenceMediaUrl,
          referenceText: request.referenceText,
          referenceAuthorName: request.referenceAuthorName,
        },
      });
      return tx.messageRequest.findUniqueOrThrow({ where: { id }, include: this.requestInclude() });
    });
  }
  async decline(userId: string, id: string) {
    const request = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id } });
    if (request.recipientId !== userId) throw new ForbiddenException();
    const claimed = await this.prisma.messageRequest.updateMany({
      where: { id, recipientId: userId, status: 'pending' },
      data: { status: 'declined' },
    });
    if (claimed.count !== 1) throw new BadRequestException('Message request is no longer pending');
    return this.prisma.messageRequest.findUniqueOrThrow({ where: { id }, include: this.requestInclude() });
  }

  async conversation(userId: string, peerId: string, query: ChatHistoryQueryDto = {}) {
    await this.ensureNotBlocked(userId, peerId);
    const messages = await this.prisma.message.findMany({
      where: {
        groupId: null,
        hiddenBy: { none: { userId } },
        OR: [{ senderId: userId, recipientId: peerId }, { senderId: peerId, recipientId: userId }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit ?? 50,
      include: this.messageInclude(),
    });
    return this.withPinnedMessageFlags(userId, messages.reverse());
  }

  async conversations(userId: string) {
    const [mutualFollows, directMessages, blockedPeerIds, mutedPeerIds, pinnedPeerIds] = await Promise.all([
      this.prisma.follow.findMany({
        where: {
          followerId: userId,
          following: { following: { some: { followingId: userId } } },
        },
        include: { following: { select: this.chatPeerSelect() } },
      }),
      this.lastDirectMessages(userId),
      this.blockedPeerIds(userId),
      this.mutedDirectPeerIds(userId),
      this.pinnedDirectPeerIds(userId),
    ]);
    const peers = new Map<string, any>();
    for (const follow of mutualFollows) {
      if (!blockedPeerIds.has(follow.following.id)) peers.set(follow.following.id, follow.following);
    }
    for (const message of directMessages) {
      const peer = message.senderId === userId ? message.recipient : message.sender;
      if (peer?.id && !blockedPeerIds.has(peer.id)) peers.set(peer.id, peer);
    }
    const peerList = [...peers.values()];
    const peerIds = peerList.map((peer) => peer.id).filter(Boolean);
    const unreadBySender = new Map<string, number>();
    if (peerIds.length) {
      const unreadRows = await this.prisma.message.groupBy({
        by: ['senderId'],
        where: {
          groupId: null,
          senderId: { in: peerIds },
          recipientId: userId,
          readAt: null,
          hiddenBy: { none: { userId } },
        },
        _count: { _all: true },
      });
      for (const row of unreadRows) unreadBySender.set(row.senderId, row._count._all);
    }
    const summaries = peerList.map((peer) => {
      const rawLastMessage = directMessages.find((message) => message.senderId === peer.id || message.recipientId === peer.id) ?? null;
      const lastMessage = rawLastMessage ? this.presentMessage(rawLastMessage) : null;
      const muted = mutedPeerIds.has(peer.id);
      const unreadCount = muted ? 0 : unreadBySender.get(peer.id) ?? 0;
      return { peer, lastMessage, unreadCount, muted, pinned: pinnedPeerIds.has(peer.id) };
    });
    return summaries.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      return new Date(b.lastMessage?.createdAt ?? 0).getTime() - new Date(a.lastMessage?.createdAt ?? 0).getTime();
    });
  }

  async buddyGroupChats(userId: string) {
    const [rooms, unreadByRoom, mutedRoomIds, pinnedRoomIds] = await Promise.all([
      this.prisma.buddyGroupChat.findMany({
        where: { members: { some: { userId } } },
        orderBy: { updatedAt: 'desc' },
        include: this.buddyGroupInclude(userId),
      }),
      this.buddyGroupUnreadCounts(userId),
      this.mutedBuddyGroupIds(userId),
      this.pinnedBuddyGroupIds(userId),
    ]);
    return rooms.map((room) => {
      const muted = mutedRoomIds.has(room.id);
      return { ...this.withLastBuddyGroupMessage(room), unreadCount: muted ? 0 : unreadByRoom.get(room.id) ?? 0, muted, pinned: pinnedRoomIds.has(room.id) };
    }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
  }

  async buddyGroupChat(userId: string, id: string) {
    await this.ensureBuddyGroupMember(userId, id);
    const [room, muted, pinned] = await Promise.all([
      this.prisma.buddyGroupChat.findUniqueOrThrow({ where: { id }, include: this.buddyGroupInclude(userId) }),
      this.isBuddyGroupMuted(userId, id),
      this.isBuddyGroupPinned(userId, id),
    ]);
    return { ...this.withLastBuddyGroupMessage(room), muted, pinned };
  }

  async createBuddyGroupChat(userId: string, dto: CreateBuddyGroupChatDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Group chat name cannot be empty');
    const participantIds = this.uniqueParticipantIds(userId, dto.participantIds);
    await this.ensureUsersExist(participantIds);
    const room = await this.prisma.buddyGroupChat.create({
      data: {
        creatorId: userId,
        name,
        description: dto.description?.trim() || null,
        members: { create: participantIds.map((participantId) => ({ userId: participantId, addedById: userId })) },
      },
      include: this.buddyGroupInclude(userId),
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

  async buddyGroupMessages(userId: string, id: string, query: ChatHistoryQueryDto = {}) {
    await this.ensureBuddyGroupMember(userId, id);
    const blockedPeerIds = [...await this.blockedPeerIds(userId)];
    const messages = await this.prisma.message.findMany({
      where: {
        buddyGroupChatId: id,
        hiddenBy: { none: { userId } },
        ...(blockedPeerIds.length ? { senderId: { notIn: blockedPeerIds } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit ?? 50,
      include: this.messageInclude(),
    });
    return this.withPinnedMessageFlags(userId, messages.reverse());
  }

  async sendBuddyGroupMessage(userId: string, id: string, dto: SendBuddyGroupMessageDto) {
    await this.ensureBuddyGroupMember(userId, id);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Message cannot be empty');
    const referenceData = await this.buddyGroupReferenceData(id, dto);
    const message = await this.prisma.message.create({
      data: { senderId: userId, buddyGroupChatId: id, body, ...referenceData },
      include: this.messageInclude(),
    });
    await this.prisma.buddyGroupChat.update({ where: { id }, data: { updatedAt: new Date() } });
    return this.presentMessage(message);
  }

  async unreadCount(userId: string) {
    const mutedPeerIds = await this.mutedDirectPeerIds(userId);
    const [directCount, groupUnread, buddyGroupUnread] = await Promise.all([
      this.prisma.message.count({
        where: {
          recipientId: userId,
          readAt: null,
          hiddenBy: { none: { userId } },
          ...(mutedPeerIds.size ? { senderId: { notIn: [...mutedPeerIds] } } : {}),
          sender: {
            blocksSent: { none: { blockedId: userId } },
            blocksReceived: { none: { blockerId: userId } },
          },
        },
      }),
      this.groupUnreadCount(userId),
      this.buddyGroupUnreadCount(userId),
    ]);
    return { count: directCount + groupUnread + buddyGroupUnread };
  }

  async setDirectMute(userId: string, peerId: string, dto: ChatMuteDto) {
    const muted = dto.muted;
    if (userId === peerId) throw new BadRequestException('Cannot mute your own chat');
    await this.ensureNotBlocked(userId, peerId);
    await this.prisma.user.findUniqueOrThrow({ where: { id: peerId }, select: { id: true } });
    if (muted) {
      const mutedUntil = this.parseMuteUntil(dto.mutedUntil);
      await this.prisma.directChatMute.upsert({
        where: { userId_peerId: { userId, peerId } },
        create: { userId, peerId, mutedUntil },
        update: { mutedUntil },
      });
    } else {
      await this.prisma.directChatMute.deleteMany({ where: { userId, peerId } });
    }
    return { peerId, muted, mutedUntil: muted ? this.parseMuteUntil(dto.mutedUntil) : null };
  }

  async setBuddyGroupMute(userId: string, buddyGroupChatId: string, dto: ChatMuteDto) {
    const muted = dto.muted;
    await this.ensureBuddyGroupMember(userId, buddyGroupChatId);
    if (muted) {
      const mutedUntil = this.parseMuteUntil(dto.mutedUntil);
      await this.prisma.buddyGroupChatMute.upsert({
        where: { userId_buddyGroupChatId: { userId, buddyGroupChatId } },
        create: { userId, buddyGroupChatId, mutedUntil },
        update: { mutedUntil },
      });
    } else {
      await this.prisma.buddyGroupChatMute.deleteMany({ where: { userId, buddyGroupChatId } });
    }
    return { buddyGroupChatId, muted, mutedUntil: muted ? this.parseMuteUntil(dto.mutedUntil) : null };
  }

  async setDirectPin(userId: string, peerId: string, dto: ChatPinDto) {
    if (userId === peerId) throw new BadRequestException('Cannot pin your own chat');
    await this.ensureNotBlocked(userId, peerId);
    await this.prisma.user.findUniqueOrThrow({ where: { id: peerId }, select: { id: true } });
    if (dto.pinned) {
      await this.prisma.directChatPin.upsert({ where: { userId_peerId: { userId, peerId } }, create: { userId, peerId }, update: {} });
    } else {
      await this.prisma.directChatPin.deleteMany({ where: { userId, peerId } });
    }
    return { peerId, pinned: dto.pinned };
  }

  async setBuddyGroupPin(userId: string, buddyGroupChatId: string, dto: ChatPinDto) {
    await this.ensureBuddyGroupMember(userId, buddyGroupChatId);
    if (dto.pinned) {
      await this.prisma.buddyGroupChatPin.upsert({ where: { userId_buddyGroupChatId: { userId, buddyGroupChatId } }, create: { userId, buddyGroupChatId }, update: {} });
    } else {
      await this.prisma.buddyGroupChatPin.deleteMany({ where: { userId, buddyGroupChatId } });
    }
    return { buddyGroupChatId, pinned: dto.pinned };
  }

  async setMessagePin(userId: string, messageId: string, dto: ChatPinDto) {
    await this.ensureCanAccessMessage(userId, messageId);
    if (dto.pinned) {
      await this.prisma.pinnedMessage.upsert({ where: { userId_messageId: { userId, messageId } }, create: { userId, messageId }, update: {} });
    } else {
      await this.prisma.pinnedMessage.deleteMany({ where: { userId, messageId } });
    }
    return { messageId, pinned: dto.pinned };
  }

  async reportMessage(userId: string, messageId: string, dto: ReportMessageDto) {
    const target = await this.ensureCanAccessMessage(userId, messageId);
    if (target.senderId === userId) throw new BadRequestException('Cannot report your own message');
    return this.prisma.messageReport.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, category: dto.category ?? 'other', note: dto.note?.trim() || null, details: dto.details?.trim() || null },
      update: { category: dto.category ?? 'other', note: dto.note?.trim() || null, details: dto.details?.trim() || null, status: 'open' },
    }).then(() => ({ ok: true }));
  }

  async messageInfo(userId: string, messageId: string) {
    await this.ensureCanAccessMessage(userId, messageId);
    const full = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { ...this.messageInclude(), pinnedBy: { where: { userId }, select: { userId: true, createdAt: true } } },
    });
    const readBy = full.groupId && full.channelId
      ? await this.prisma.groupChatReadState.findMany({
          where: { channelId: full.channelId, lastReadAt: { gte: full.createdAt } },
          include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } },
          orderBy: { lastReadAt: 'asc' },
        })
      : full.buddyGroupChatId
        ? await this.prisma.buddyGroupChatReadState.findMany({
            where: { buddyGroupChatId: full.buddyGroupChatId, lastReadAt: { gte: full.createdAt } },
            include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } },
            orderBy: { lastReadAt: 'asc' },
          })
        : [];
    return {
      message: { ...this.presentMessage(full), pinned: full.pinnedBy.length > 0 },
      readBy: readBy.map((state) => ({
        userId: state.userId,
        lastReadAt: state.lastReadAt,
        user: state.user,
      })),
      directReadAt: full.readAt,
    };
  }

  async searchMessages(userId: string, q = '') {
    const term = q.trim();
    if (term.length < 2) return [];
    const whereText = { contains: term, mode: Prisma.QueryMode.insensitive };
    const blockedPeerIds = [...await this.blockedPeerIds(userId)];
    const [direct, buddyGroups, groups] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          body: whereText,
          groupId: null,
          buddyGroupChatId: null,
          hiddenBy: { none: { userId } },
          ...(blockedPeerIds.length ? { senderId: { notIn: blockedPeerIds }, recipientId: { notIn: blockedPeerIds } } : {}),
          OR: [{ senderId: userId }, { recipientId: userId }],
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: this.messageInclude(),
      }),
      this.prisma.message.findMany({
        where: {
          body: whereText,
          buddyGroupChat: { members: { some: { userId } } },
          hiddenBy: { none: { userId } },
          ...(blockedPeerIds.length ? { senderId: { notIn: blockedPeerIds } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { ...this.messageInclude(), buddyGroupChat: { select: { id: true, name: true } } },
      }),
      this.prisma.message.findMany({
        where: {
          body: whereText,
          group: { members: { some: { userId } } },
          hiddenBy: { none: { userId } },
          ...(blockedPeerIds.length ? { senderId: { notIn: blockedPeerIds } } : {}),
          OR: [
            { channel: null },
            { channel: { visibility: 'public' } },
            { channel: { allowedUsers: { some: { userId } } } },
            { group: { members: { some: { userId, role: { in: ['owner', 'admin'] } } } } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { ...this.messageInclude(), group: { select: { id: true, name: true, slug: true } }, channel: { select: { id: true, name: true } } },
      }),
    ]);
    return [
      ...direct.map((message) => ({ kind: 'direct', message: this.presentMessage(message) })),
      ...buddyGroups.map((message) => ({ kind: 'buddyGroup', message: this.presentMessage(message) })),
      ...groups.map((message) => ({ kind: 'group', message: this.presentMessage(message) })),
    ]
      .sort((a, b) => new Date(b.message.createdAt).getTime() - new Date(a.message.createdAt).getTime())
      .slice(0, 50);
  }

  async markRead(userId: string, peerId: string) {
    if (userId === peerId) throw new BadRequestException('Cannot mark your own conversation read');
    await this.ensureNotBlocked(userId, peerId);
    const readAt = new Date();
    const result = await this.prisma.message.updateMany({ where: { senderId: peerId, recipientId: userId, readAt: null }, data: { readAt } });
    return { ...(await this.unreadCount(userId)), readAt, readCount: result.count };
  }

  async assertDirectMessagingAllowed(userId: string, peerId: string) {
    if (userId === peerId) throw new BadRequestException('Cannot message yourself');
    await this.ensureNotBlocked(userId, peerId);
    await this.ensureDirectMessagingAllowed(userId, peerId);
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
    const normalizedEmoji = this.allowedReaction(emoji);
    await this.ensureCanAccessMessage(userId, messageId);
    await this.prisma.messageReaction.deleteMany({ where: { messageId, userId, emoji: normalizedEmoji } });
    return this.message(messageId);
  }

  async deleteForMe(userId: string, messageId: string) {
    await this.ensureCanAccessMessage(userId, messageId);
    await this.prisma.hiddenMessage.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId },
      update: {},
    });
    return { ok: true };
  }

  async unsendMessage(userId: string, messageId: string) {
    const message = await this.ensureCanAccessMessage(userId, messageId);
    if (message.senderId !== userId) throw new ForbiddenException('Only the sender can delete this message');
    const deletedAt = new Date();
    await this.prisma.messageReaction.deleteMany({ where: { messageId } });
    const updated = await this.prisma.message.update({
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
    return this.presentMessage(updated);
  }

  private async message(messageId: string) {
    return this.presentMessage(await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: this.messageInclude() }));
  }

  private allowedReaction(emoji: string) {
    if (typeof emoji !== 'string') throw new BadRequestException('Unsupported reaction');
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
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { senderId: true, recipientId: true, groupId: true, channelId: true, buddyGroupChatId: true } });
    if (message.buddyGroupChatId) {
      await this.ensureBuddyGroupMember(userId, message.buddyGroupChatId);
      return message;
    }
    if (!message.groupId) {
      if (message.senderId !== userId && message.recipientId !== userId) throw new ForbiddenException();
      return message;
    }
    const member = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: message.groupId, userId } }, select: { role: true } });
    if (!member) throw new ForbiddenException();
    if (message.channelId) {
      const channel = await this.prisma.groupChatChannel.findUniqueOrThrow({
        where: { id: message.channelId },
        select: { groupId: true, visibility: true, allowedUsers: { where: { userId }, select: { userId: true } } },
      });
      const canManage = member.role === 'owner' || member.role === 'admin';
      if (channel.groupId !== message.groupId || (channel.visibility === 'private' && !canManage && channel.allowedUsers.length === 0)) {
        throw new ForbiddenException('This private channel is invite-only');
      }
    }
    return message;
  }

  private async ensureCanAccessDirectMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { senderId: true, recipientId: true, groupId: true, buddyGroupChatId: true } });
    if (message.groupId || message.buddyGroupChatId || !message.recipientId) throw new ForbiddenException('Direct message only');
    if (message.senderId !== userId && message.recipientId !== userId) throw new ForbiddenException();
    return message;
  }

  private async ensureDirectMessagingAllowed(userId: string, peerId: string) {
    if (!(await this.canSendDirectly(userId, peerId))) throw new ForbiddenException('Send a message request first.');
  }

  private directEncryptedPayload(dto: SendDirectMessageDto) {
    if (typeof dto.body !== 'string') throw new BadRequestException('Message body is required');
    if (dto.encrypted) {
      throw new BadRequestException('New encrypted messages are disabled until secure device keys are available');
    }
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Message cannot be empty');
    return { body, ciphertext: null, nonce: null, encrypted: false };
  }

  private async ensureNotBlocked(userId: string, peerId: string) {
    if (await this.hasBlockBetween(userId, peerId)) throw new ForbiddenException('You cannot message this user.');
  }

  private async hasBlockBetween(userId: string, peerId: string) {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: peerId },
          { blockerId: peerId, blockedId: userId },
        ],
      },
      select: { blockerId: true },
    });
    return Boolean(block);
  }

  private async blockedPeerIds(userId: string) {
    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    return new Set(blocks.map((block) => block.blockerId === userId ? block.blockedId : block.blockerId));
  }

  private async mutedDirectPeerIds(userId: string) {
    const mutes = await this.prisma.directChatMute.findMany({ where: this.activeMuteWhere(userId), select: { peerId: true } });
    return new Set(mutes.map((mute) => mute.peerId));
  }

  private async pinnedDirectPeerIds(userId: string) {
    const pins = await (this.prisma.directChatPin?.findMany({ where: { userId }, select: { peerId: true } }) ?? Promise.resolve([]));
    return new Set(pins.map((pin) => pin.peerId));
  }

  private async isMutual(userId: string, peerId: string) {
    const [following, followsMe] = await Promise.all([
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: peerId } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: peerId, followingId: userId } } }),
    ]);
    return Boolean(following && followsMe);
  }

  private async canSendDirectly(userId: string, peerId: string) {
    if (await this.isMutual(userId, peerId)) return true;
    return this.hasAcceptedMessageRequest(userId, peerId);
  }

  private async hasAcceptedMessageRequest(userId: string, peerId: string) {
    const request = await this.prisma.messageRequest.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { senderId: userId, recipientId: peerId },
          { senderId: peerId, recipientId: userId },
        ],
      },
      select: { id: true },
    });
    return Boolean(request);
  }

  private pendingMessageRequestWhere(userId: string, peerId: string) {
    return {
      status: 'pending' as const,
      OR: [
        { senderId: userId, recipientId: peerId },
        { senderId: peerId, recipientId: userId },
      ],
    };
  }

  private async lastDirectMessages(userId: string) {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT latest."id"
      FROM (
        SELECT DISTINCT ON (
          CASE WHEN message."sender_id" = ${userId} THEN message."recipient_id" ELSE message."sender_id" END
        ) message."id", message."created_at"
        FROM "messages" AS message
        WHERE message."group_id" IS NULL
          AND message."buddy_group_chat_id" IS NULL
          AND message."recipient_id" IS NOT NULL
          AND (message."sender_id" = ${userId} OR message."recipient_id" = ${userId})
          AND NOT EXISTS (
            SELECT 1 FROM "hidden_messages" AS hidden
            WHERE hidden."message_id" = message."id" AND hidden."user_id" = ${userId}
          )
        ORDER BY
          CASE WHEN message."sender_id" = ${userId} THEN message."recipient_id" ELSE message."sender_id" END,
          message."created_at" DESC,
          message."id" DESC
      ) AS latest
      ORDER BY latest."created_at" DESC, latest."id" DESC
    `);
    const messageIds = ids.map((row) => row.id).filter(Boolean);
    if (!messageIds.length) return [];
    return this.prisma.message.findMany({
      where: { id: { in: messageIds } },
      include: this.messageInclude(),
    });
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
    return {
      id: room.id,
      creatorId: room.creatorId,
      name: room.name,
      description: room.description ?? null,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      members: (room.members ?? []).map((member: any) => ({
        userId: member.userId,
        joinedAt: member.joinedAt,
        user: member.user,
      })),
      lastMessage: room.messages?.[0] ? this.presentMessage(room.messages[0]) : null,
      _count: {
        members: room._count?.members ?? 0,
        messages: room._count?.messages ?? 0,
      },
    };
  }

  async markBuddyGroupRead(userId: string, buddyGroupChatId: string) {
    await this.ensureBuddyGroupMember(userId, buddyGroupChatId);
    const readAt = new Date();
    const state = await this.prisma.buddyGroupChatReadState.upsert({
      where: { userId_buddyGroupChatId: { userId, buddyGroupChatId } },
      create: { userId, buddyGroupChatId, lastReadAt: readAt },
      update: { lastReadAt: readAt },
    });
    return { ok: true, buddyGroupChatId, userId, readAt: state.lastReadAt };
  }

  private async groupUnreadCount(userId: string) {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "messages" AS message
      INNER JOIN "group_members" AS member
        ON member."group_id" = message."group_id"
        AND member."user_id" = ${userId}
      LEFT JOIN "group_chat_channels" AS channel
        ON channel."id" = message."channel_id"
      LEFT JOIN "group_chat_channel_members" AS channel_member
        ON channel_member."channel_id" = message."channel_id"
        AND channel_member."user_id" = ${userId}
      LEFT JOIN "group_chat_read_states" AS read_state
        ON read_state."user_id" = ${userId}
        AND read_state."channel_id" = message."channel_id"
      LEFT JOIN "group_chat_mutes" AS group_mute
        ON group_mute."user_id" = ${userId}
        AND group_mute."group_id" = message."group_id"
      LEFT JOIN "group_chat_channel_mutes" AS channel_mute
        ON channel_mute."user_id" = ${userId}
        AND channel_mute."channel_id" = message."channel_id"
      WHERE message."group_id" IS NOT NULL
        AND (group_mute."user_id" IS NULL OR group_mute."muted_until" <= NOW())
        AND (channel_mute."user_id" IS NULL OR channel_mute."muted_until" <= NOW())
        AND message."sender_id" <> ${userId}
        AND message."created_at" > COALESCE(read_state."last_read_at", member."joined_at")
        AND NOT EXISTS (
          SELECT 1 FROM "hidden_messages" AS hidden
          WHERE hidden."message_id" = message."id"
            AND hidden."user_id" = ${userId}
        )
        AND (
          channel."id" IS NULL
          OR channel."visibility" = 'public'::group_chat_channel_visibility
          OR member."role" IN ('owner'::group_role, 'admin'::group_role)
          OR channel_member."user_id" IS NOT NULL
        )
    `);
    return Number(rows[0]?.count ?? 0n);
  }

  private async buddyGroupUnreadCount(userId: string) {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "messages" AS message
      INNER JOIN "buddy_group_chat_members" AS member
        ON member."buddy_group_chat_id" = message."buddy_group_chat_id"
        AND member."user_id" = ${userId}
      LEFT JOIN "buddy_group_chat_read_states" AS read_state
        ON read_state."user_id" = ${userId}
        AND read_state."buddy_group_chat_id" = message."buddy_group_chat_id"
      LEFT JOIN "buddy_group_chat_mutes" AS mute
        ON mute."user_id" = ${userId}
        AND mute."buddy_group_chat_id" = message."buddy_group_chat_id"
      WHERE message."buddy_group_chat_id" IS NOT NULL
        AND (mute."user_id" IS NULL OR mute."muted_until" <= NOW())
        AND message."sender_id" <> ${userId}
        AND message."created_at" > COALESCE(read_state."last_read_at", member."joined_at")
        AND NOT EXISTS (
          SELECT 1 FROM "blocks" AS block
          WHERE (block."blocker_id" = ${userId} AND block."blocked_id" = message."sender_id")
             OR (block."blocker_id" = message."sender_id" AND block."blocked_id" = ${userId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM "hidden_messages" AS hidden
          WHERE hidden."message_id" = message."id"
            AND hidden."user_id" = ${userId}
        )
    `);
    return Number(rows[0]?.count ?? 0n);
  }

  private async buddyGroupUnreadCounts(userId: string) {
    const rows = await this.prisma.$queryRaw<{ buddyGroupChatId: string; count: bigint }[]>(Prisma.sql`
      SELECT message."buddy_group_chat_id" AS "buddyGroupChatId", COUNT(*)::bigint AS count
      FROM "messages" AS message
      INNER JOIN "buddy_group_chat_members" AS member
        ON member."buddy_group_chat_id" = message."buddy_group_chat_id"
        AND member."user_id" = ${userId}
      LEFT JOIN "buddy_group_chat_read_states" AS read_state
        ON read_state."user_id" = ${userId}
        AND read_state."buddy_group_chat_id" = message."buddy_group_chat_id"
      LEFT JOIN "buddy_group_chat_mutes" AS mute
        ON mute."user_id" = ${userId}
        AND mute."buddy_group_chat_id" = message."buddy_group_chat_id"
      WHERE message."buddy_group_chat_id" IS NOT NULL
        AND (mute."user_id" IS NULL OR mute."muted_until" <= NOW())
        AND message."sender_id" <> ${userId}
        AND message."created_at" > COALESCE(read_state."last_read_at", member."joined_at")
        AND NOT EXISTS (
          SELECT 1 FROM "blocks" AS block
          WHERE (block."blocker_id" = ${userId} AND block."blocked_id" = message."sender_id")
             OR (block."blocker_id" = message."sender_id" AND block."blocked_id" = ${userId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM "hidden_messages" AS hidden
          WHERE hidden."message_id" = message."id"
            AND hidden."user_id" = ${userId}
        )
      GROUP BY message."buddy_group_chat_id"
    `);
    return new Map(rows.map((row) => [row.buddyGroupChatId, Number(row.count)]));
  }

  private async mutedBuddyGroupIds(userId: string) {
    const mutes = await this.prisma.buddyGroupChatMute.findMany({ where: this.activeMuteWhere(userId), select: { buddyGroupChatId: true } });
    return new Set(mutes.map((mute) => mute.buddyGroupChatId));
  }

  private async isBuddyGroupMuted(userId: string, buddyGroupChatId: string) {
    return Boolean(await this.prisma.buddyGroupChatMute.findFirst({ where: { ...this.activeMuteWhere(userId), buddyGroupChatId }, select: { userId: true } }));
  }

  private async pinnedBuddyGroupIds(userId: string) {
    const pins = await (this.prisma.buddyGroupChatPin?.findMany({ where: { userId }, select: { buddyGroupChatId: true } }) ?? Promise.resolve([]));
    return new Set(pins.map((pin) => pin.buddyGroupChatId));
  }

  private async isBuddyGroupPinned(userId: string, buddyGroupChatId: string) {
    return Boolean(await this.prisma.buddyGroupChatPin.findUnique({ where: { userId_buddyGroupChatId: { userId, buddyGroupChatId } }, select: { userId: true } }));
  }

  private activeMuteWhere(userId: string) {
    return { userId, OR: [{ mutedUntil: null }, { mutedUntil: { gt: new Date() } }] };
  }

  private parseMuteUntil(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new BadRequestException('Mute expiration must be in the future');
    return date;
  }

  private async withPinnedMessageFlags<T extends { id: string }>(userId: string, messages: T[]) {
    if (!messages.length) return messages;
    const pins = await this.prisma.pinnedMessage.findMany({ where: { userId, messageId: { in: messages.map((message) => message.id) } }, select: { messageId: true } });
    const pinnedIds = new Set(pins.map((pin) => pin.messageId));
    return messages.map((message) => ({ ...this.presentMessage(message), pinned: pinnedIds.has(message.id) }));
  }

  private presentMessage(message: any) {
    const presented = { ...message };
    delete presented.pinnedBy;
    return {
      ...presented,
      reactions: (message.reactions ?? []).map((reaction: any) => ({
        emoji: reaction.emoji,
        userId: reaction.userId,
      })),
    };
  }

  private buddyGroupInclude(userId?: string) {
    const visibleMessageWhere = userId ? {
      hiddenBy: { none: { userId } },
      sender: {
        blocksSent: { none: { blockedId: userId } },
        blocksReceived: { none: { blockerId: userId } },
      },
    } : undefined;
    return {
      members: {
        orderBy: { joinedAt: 'asc' },
        select: { userId: true, joinedAt: true, user: { select: this.chatPeerSelect() } },
      },
      messages: {
        ...(visibleMessageWhere ? { where: visibleMessageWhere } : {}),
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: this.messageInclude(),
      },
      _count: { select: { members: true, messages: visibleMessageWhere ? { where: visibleMessageWhere } : true } },
    } as const;
  }

  private messageInclude() { return { sender: { select: { id: true, displayName: true, username: true, profileImageUrl: true } }, recipient: { select: { id: true, displayName: true, username: true, profileImageUrl: true } }, reactions: true } as const; }
  private chatPeerSelect() { return { id: true, displayName: true, username: true, profileImageUrl: true, chatPublicKey: true } as const; }
  private requestInclude() { return { sender: { select: { id: true, displayName: true, username: true, bio: true, profileImageUrl: true, chatPublicKey: true } }, recipient: { select: { id: true, displayName: true, username: true, profileImageUrl: true, chatPublicKey: true } } } as const; }
  private async directReferenceData(senderId: string, recipientId: string, dto: SendDirectMessageDto, trustedReference = false) {
    if (trustedReference) return this.referenceData(dto, true);
    if (dto.referenceType !== 'message' || !dto.referenceId) return {};
    const target = await this.prisma.message.findUniqueOrThrow({
      where: { id: dto.referenceId },
      select: {
        id: true,
        senderId: true,
        recipientId: true,
        groupId: true,
        buddyGroupChatId: true,
        body: true,
        deletedAt: true,
        sender: { select: { displayName: true, username: true } },
      },
    });
    const participants = new Set([senderId, recipientId]);
    if (target.groupId || target.buddyGroupChatId || !target.recipientId || !participants.has(target.senderId) || !participants.has(target.recipientId)) {
      throw new BadRequestException('Reply target is not in this conversation.');
    }
    if (target.deletedAt) throw new BadRequestException('Reply target is no longer available.');
    return this.serverMessageReference(target);
  }

  private async buddyGroupReferenceData(buddyGroupChatId: string, dto: SendBuddyGroupMessageDto) {
    if (dto.referenceType !== 'message' || !dto.referenceId) return {};
    const target = await this.prisma.message.findUniqueOrThrow({
      where: { id: dto.referenceId },
      select: {
        id: true,
        buddyGroupChatId: true,
        body: true,
        deletedAt: true,
        sender: { select: { displayName: true, username: true } },
      },
    });
    if (target.buddyGroupChatId !== buddyGroupChatId) throw new BadRequestException('Reply target is not in this group buddies chat.');
    if (target.deletedAt) throw new BadRequestException('Reply target is no longer available.');
    return this.serverMessageReference(target);
  }

  private serverMessageReference(target: { id: string; body: string; sender: { displayName: string | null; username: string | null } }) {
    return {
      referenceType: 'message',
      referenceId: target.id,
      referenceText: target.body.slice(0, 500),
      referenceAuthorName: (target.sender.displayName || target.sender.username || '').slice(0, 120) || undefined,
    };
  }

  private referenceData(dto: SendDirectMessageDto | SendBuddyGroupMessageDto, trustedReference = false) {
    if (!trustedReference) return {};
    return {
      referenceType: dto.referenceType,
      referenceId: dto.referenceId?.trim() || undefined,
      referenceMediaUrl: 'referenceMediaUrl' in dto ? dto.referenceMediaUrl?.trim() || undefined : undefined,
      referenceText: dto.referenceText?.trim() || undefined,
      referenceAuthorName: dto.referenceAuthorName?.trim() || undefined,
    };
  }
}
