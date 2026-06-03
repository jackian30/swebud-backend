import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    if (senderId === dto.recipientId) throw new BadRequestException('Cannot message yourself');
    await this.ensureNotBlocked(senderId, dto.recipientId);
    await this.ensureDirectMessagingAllowed(senderId, dto.recipientId);
    const referenceData = await this.directReferenceData(senderId, dto.recipientId, dto, trustedReference);
    return this.prisma.message.create({
      data: {
        senderId,
        recipientId: dto.recipientId,
        body: dto.encrypted ? '[encrypted]' : dto.body.trim(),
        ciphertext: dto.ciphertext,
        nonce: dto.nonce,
        encrypted: Boolean(dto.encrypted),
        ...referenceData,
      },
      include: this.messageInclude(),
    });
  }

  async request(senderId: string, dto: SendDirectMessageDto, trustedReference = false) {
    if (senderId === dto.recipientId) throw new BadRequestException('Cannot message yourself');
    await this.ensureNotBlocked(senderId, dto.recipientId);
    if (await this.canSendDirectly(senderId, dto.recipientId)) return this.send(senderId, dto, trustedReference);
    const request = await this.prisma.messageRequest.create({ data: { senderId, recipientId: dto.recipientId, body: dto.encrypted ? '[encrypted request]' : dto.body.trim(), ...this.referenceData(dto, trustedReference) }, include: this.requestInclude() });
    void this.notifications.create({ userId: dto.recipientId, actorId: senderId, type: 'message_request', entityId: request.id, message: 'sent you a message request' });
    return request;
  }

  async requests(userId: string) {
    await this.acceptMutualRequests(userId);
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

  async accept(userId: string, id: string) { const req = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id } }); if (req.recipientId !== userId) throw new ForbiddenException(); await this.ensureNotBlocked(req.senderId, req.recipientId); await this.prisma.message.create({ data: { senderId: req.senderId, recipientId: req.recipientId, body: req.body, referenceType: req.referenceType, referenceId: req.referenceId, referenceMediaUrl: req.referenceMediaUrl, referenceText: req.referenceText, referenceAuthorName: req.referenceAuthorName } }); return this.prisma.messageRequest.update({ where: { id }, data: { status: 'accepted' }, include: this.requestInclude() }); }
  async decline(userId: string, id: string) { const req = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id } }); if (req.recipientId !== userId) throw new ForbiddenException(); return this.prisma.messageRequest.update({ where: { id }, data: { status: 'declined' }, include: this.requestInclude() }); }

  async conversation(userId: string, peerId: string) {
    await this.ensureNotBlocked(userId, peerId);
    return this.prisma.message.findMany({
      where: {
        groupId: null,
        hiddenBy: { none: { userId } },
        OR: [{ senderId: userId, recipientId: peerId }, { senderId: peerId, recipientId: userId }],
      },
      orderBy: { createdAt: 'asc' },
      include: this.messageInclude(),
    });
  }

  async conversations(userId: string) {
    await this.acceptMutualRequests(userId);
    const [mutualFollows, directMessages, blockedPeerIds] = await Promise.all([
      this.prisma.follow.findMany({
        where: {
          followerId: userId,
          following: { following: { some: { followingId: userId } } },
        },
        include: { following: { select: this.chatPeerSelect() } },
      }),
      this.prisma.message.findMany({
        where: { groupId: null, hiddenBy: { none: { userId } }, OR: [{ senderId: userId }, { recipientId: userId }] },
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: this.messageInclude(),
      }),
      this.blockedPeerIds(userId),
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
    const [rooms, unreadByRoom] = await Promise.all([
      this.prisma.buddyGroupChat.findMany({
        where: { members: { some: { userId } } },
        orderBy: { updatedAt: 'desc' },
        include: this.buddyGroupInclude(),
      }),
      this.buddyGroupUnreadCounts(userId),
    ]);
    return rooms.map((room) => ({ ...this.withLastBuddyGroupMessage(room), unreadCount: unreadByRoom.get(room.id) ?? 0 }));
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
    const messages = await this.prisma.message.findMany({ where: { buddyGroupChatId: id, hiddenBy: { none: { userId } } }, orderBy: { createdAt: 'asc' }, include: this.messageInclude() });
    await this.markBuddyGroupRead(userId, id);
    return messages;
  }

  async sendBuddyGroupMessage(userId: string, id: string, dto: SendBuddyGroupMessageDto) {
    await this.ensureBuddyGroupMember(userId, id);
    const referenceData = await this.buddyGroupReferenceData(id, dto);
    const message = await this.prisma.message.create({
      data: { senderId: userId, buddyGroupChatId: id, body: dto.body.trim(), ...referenceData },
      include: this.messageInclude(),
    });
    await this.prisma.buddyGroupChat.update({ where: { id }, data: { updatedAt: new Date() } });
    return message;
  }

  async unreadCount(userId: string) {
    const [directCount, groupUnread, buddyGroupUnread] = await Promise.all([
      this.prisma.message.count({
        where: {
          recipientId: userId,
          readAt: null,
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

  async markRead(userId: string, peerId: string) {
    if (userId === peerId) throw new BadRequestException('Cannot mark your own conversation read');
    await this.ensureNotBlocked(userId, peerId);
    const readAt = new Date();
    const result = await this.prisma.message.updateMany({ where: { senderId: peerId, recipientId: userId, readAt: null }, data: { readAt } });
    return { ...(await this.unreadCount(userId)), readAt, readCount: result.count };
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

  private async ensureDirectMessagingAllowed(userId: string, peerId: string) {
    if (!(await this.canSendDirectly(userId, peerId))) throw new ForbiddenException('Send a message request first.');
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

  private async acceptMutualRequests(userId: string) {
    const pending = await this.prisma.messageRequest.findMany({
      where: { recipientId: userId, status: 'pending' },
      select: { id: true, senderId: true, recipientId: true, body: true, referenceType: true, referenceId: true, referenceMediaUrl: true, referenceText: true, referenceAuthorName: true },
    });
    const mutualRequests = [];
    for (const request of pending) {
      if ((await this.isMutual(request.senderId, request.recipientId)) && !(await this.hasBlockBetween(request.senderId, request.recipientId))) mutualRequests.push(request);
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

  private async markBuddyGroupRead(userId: string, buddyGroupChatId: string) {
    await this.prisma.buddyGroupChatReadState.upsert({
      where: { userId_buddyGroupChatId: { userId, buddyGroupChatId } },
      create: { userId, buddyGroupChatId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
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
      WHERE message."group_id" IS NOT NULL
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
      WHERE message."buddy_group_chat_id" IS NOT NULL
        AND message."sender_id" <> ${userId}
        AND message."created_at" > COALESCE(read_state."last_read_at", member."joined_at")
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
      WHERE message."buddy_group_chat_id" IS NOT NULL
        AND message."sender_id" <> ${userId}
        AND message."created_at" > COALESCE(read_state."last_read_at", member."joined_at")
        AND NOT EXISTS (
          SELECT 1 FROM "hidden_messages" AS hidden
          WHERE hidden."message_id" = message."id"
            AND hidden."user_id" = ${userId}
        )
      GROUP BY message."buddy_group_chat_id"
    `);
    return new Map(rows.map((row) => [row.buddyGroupChatId, Number(row.count)]));
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
  private async directReferenceData(senderId: string, recipientId: string, dto: SendDirectMessageDto, trustedReference = false) {
    if (trustedReference) return this.referenceData(dto, true);
    if (dto.referenceType !== 'message' || !dto.referenceId) return {};
    const target = await this.prisma.message.findUniqueOrThrow({
      where: { id: dto.referenceId },
      select: { senderId: true, recipientId: true, groupId: true, buddyGroupChatId: true },
    });
    const participants = new Set([senderId, recipientId]);
    if (target.groupId || target.buddyGroupChatId || !target.recipientId || !participants.has(target.senderId) || !participants.has(target.recipientId)) {
      throw new BadRequestException('Reply target is not in this conversation.');
    }
    return this.referenceData(dto, true);
  }

  private async buddyGroupReferenceData(buddyGroupChatId: string, dto: SendBuddyGroupMessageDto) {
    if (dto.referenceType !== 'message' || !dto.referenceId) return {};
    const target = await this.prisma.message.findUniqueOrThrow({
      where: { id: dto.referenceId },
      select: { buddyGroupChatId: true },
    });
    if (target.buddyGroupChatId !== buddyGroupChatId) throw new BadRequestException('Reply target is not in this group buddies chat.');
    return this.referenceData(dto, true);
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
