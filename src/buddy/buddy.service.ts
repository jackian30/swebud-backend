import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomBytes } from 'crypto';
import { BuddyDiscoveryAudience, BuddySessionMessageKind, BuddySessionScope, BuddySessionVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BuddyRoomQueryDto, CreateBuddyRoomDto, InviteBuddyRoomDto, JoinBuddyRoomDto, KickBuddyRoomParticipantDto, NearbyBuddyQueryDto, SendBuddySessionMessageDto, UpsertBuddySessionDto } from './dto';
import { activityPersonaLinkSelect, exposeActivityPersonas } from '../common/activity-personas';
import { NotificationsGateway } from '../notifications/notifications.gateway';

const DEFAULT_TTL_MINUTES = 60;
const ROOM_INACTIVITY_MS = 60 * 60_000;
const DEFAULT_RADIUS_KM = 100;
const DEFAULT_TAKE = 50;
const BUDDY_CLEANUP_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class BuddyService {
  private realtime: NotificationsGateway | null | undefined;
  private cleanupPromise: Promise<void> | null = null;
  private lastCleanupAt = 0;

  constructor(private prisma: PrismaService, private moduleRef: ModuleRef) {}

  async me(userId: string) {
    this.scheduleExpiredDataCleanup();
    const now = new Date();
    const session = await this.prisma.buddySession.findUnique({ where: { userId }, include: this.sessionInclude() });
    if (!session) return null;
    if (session.expiresAt <= now) {
      await this.stop(userId);
      return null;
    }
    return this.toBuddy(session, session.latitude, session.longitude);
  }

  async upsert(userId: string, dto: UpsertBuddySessionDto) {
    const room = dto.roomId ? await this.ensureCanJoinRoom(userId, { roomId: dto.roomId }) : null;
    if (!room) await this.ensureActivityOption(dto.activity);
    return this.saveSession(userId, dto, room);
  }

  private async saveSession(userId: string, dto: UpsertBuddySessionDto, room: any) {
    const previousSession = await this.prisma.buddySession.findUnique({ where: { userId }, select: { roomId: true, expiresAt: true } });
    const wasActiveInRoom = Boolean(room?.id && previousSession && previousSession.roomId === room.id && previousSession.expiresAt > new Date());
    const ttlMinutes = Math.min(Math.max(dto.ttlMinutes ?? DEFAULT_TTL_MINUTES, 5), 120);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const activity = room?.activity ?? dto.activity?.trim() ?? null;
    const subActivity = (room?.subActivity ?? dto.subActivity)?.trim() || null;
    const note = dto.note?.trim() || null;
    const visibleTo = dto.visibleTo ?? BuddyDiscoveryAudience.public;
    const canSee = dto.canSee ?? BuddyDiscoveryAudience.public;
    const session = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.buddySession.upsert({
        where: { userId },
        create: { userId, roomId: room?.id ?? null, activity, subActivity, note, visibleTo, canSee, latitude: dto.latitude, longitude: dto.longitude, expiresAt },
        update: {
          roomId: room?.id ?? null,
          activity,
          subActivity,
          note,
          ...(dto.visibleTo !== undefined ? { visibleTo: dto.visibleTo } : {}),
          ...(dto.canSee !== undefined ? { canSee: dto.canSee } : {}),
          latitude: dto.latitude,
          longitude: dto.longitude,
          expiresAt,
        },
        include: this.sessionInclude(),
      });
      if (room?.id) {
        await tx.buddyRoomParticipant.upsert({
          where: { roomId_userId: { roomId: room.id, userId } },
          create: { roomId: room.id, userId },
          update: { kickedAt: null, kickedById: null },
        });
        await tx.buddyRoom.updateMany({ where: { id: room.id }, data: { expiresAt: this.roomExpiresAt() } });
      }
      return saved;
    });
    if (previousSession?.roomId && previousSession.roomId !== room?.id) {
      await this.emitRoomLeft(userId, previousSession.roomId).catch(() => undefined);
      await this.closeRoomIfNoActiveParticipants(previousSession.roomId);
    }
    const buddy = this.toBuddy(session, dto.latitude, dto.longitude);
    if (room?.id && !wasActiveInRoom) {
      await this.createRoomEventMessage(room.id, userId, BuddySessionMessageKind.joined).catch(() => undefined);
      await this.emitRoomJoined(userId, room.id, buddy).catch(() => undefined);
    }
    return buddy;
  }

  async stop(userId: string) {
    const session = await this.prisma.buddySession.findUnique({ where: { userId }, select: { roomId: true } });
    await this.prisma.buddySession.delete({ where: { userId } }).catch(() => null);
    if (session?.roomId) {
      await this.createRoomEventMessage(session.roomId, userId, BuddySessionMessageKind.left).catch(() => undefined);
      await this.emitRoomLeft(userId, session.roomId).catch(() => undefined);
      await this.closeRoomIfNoActiveParticipants(session.roomId);
    }
    return { ok: true };
  }

  async nearby(userId: string, query: NearbyBuddyQueryDto) {
    this.scheduleExpiredDataCleanup();
    const queryActivity = query.activity?.trim() || null;
    await this.ensureActivityOption(queryActivity);
    const now = new Date();
    const radiusKm = query.radiusKm ?? DEFAULT_RADIUS_KM;
    const take = query.take ?? DEFAULT_TAKE;
    const blocked = await this.blockedUserIds(userId);
    const room = query.roomId ? await this.ensureCanJoinRoom(userId, { roomId: query.roomId }) : null;
    const viewerSession = await this.prisma.buddySession.findUnique({ where: { userId }, select: { canSee: true, expiresAt: true } });
    const canSee = viewerSession && viewerSession.expiresAt > now ? viewerSession.canSee : BuddyDiscoveryAudience.public;
    const sessions = await this.prisma.buddySession.findMany({
      where: {
        userId: { not: userId, notIn: blocked },
        roomId: room ? room.id : null,
        ...(queryActivity && !room ? { activity: queryActivity } : {}),
        expiresAt: { gt: now },
        ...(!room ? this.nearbyBoundsWhere(query.lat, query.lng, radiusKm) : {}),
        ...(!room ? {
          AND: [
            this.visibleToViewerWhere(userId),
            this.viewerCanSeeWhere(userId, canSee),
          ],
        } : {}),
      },
      include: this.sessionInclude(),
      orderBy: { updatedAt: 'desc' },
      take: 250,
    });
    const sorted = sessions
      .map((session) => this.toBuddy(session, query.lat, query.lng))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    return room ? sorted : sorted.filter((session) => session.distanceKm <= radiusKm).slice(0, take);
  }

  async rooms(userId: string, query: BuddyRoomQueryDto = {}) {
    this.scheduleExpiredDataCleanup();
    const now = new Date();
    const baseWhere: any = { expiresAt: { gt: now } };
    if (query.groupId) {
      await this.ensureGroupMember(userId, query.groupId);
      baseWhere.scope = 'group';
      baseWhere.groupId = query.groupId;
    } else if (query.scope === 'group') {
      const memberships = await this.prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } });
      baseWhere.scope = 'group';
      baseWhere.groupId = { in: memberships.map((member) => member.groupId) };
    } else {
      baseWhere.scope = 'public';
      baseWhere.OR = [
        { creatorId: userId },
        { participants: { some: { userId, kickedAt: null } } },
      ];
    }
    baseWhere.NOT = { participants: { some: { userId, kickedAt: { not: null } } } };
    const where = { ...baseWhere, sessions: { some: { expiresAt: { gt: now } } } };
    const rooms = await this.prisma.buddyRoom.findMany({ where, orderBy: { createdAt: 'desc' }, include: this.roomInclude(now) });
    await this.closeInactiveRoomsForList(baseWhere, now);
    return rooms.map((room) => this.toRoom(room, this.canRevealRoomCode(userId, room)));
  }

  async room(userId: string, roomId: string) {
    this.scheduleExpiredDataCleanup();
    const room = await this.ensureCanJoinRoom(userId, { roomId });
    return this.toRoom(room, this.canRevealRoomCode(userId, room));
  }

  async createRoom(userId: string, dto: CreateBuddyRoomDto) {
    await this.ensureActivityOption(dto.activity);
    const scope = dto.groupId ? BuddySessionScope.group : (dto.scope ?? BuddySessionScope.public);
    if (scope === BuddySessionScope.group) {
      if (!dto.groupId) throw new BadRequestException('Group buddy sessions need a group.');
      await this.ensureGroupMember(userId, dto.groupId);
    }
    const name = dto.name?.trim() || await this.defaultRoomName(userId);
    const room = await this.prisma.buddyRoom.create({
      data: {
        name,
        scope,
        visibility: dto.visibility ?? BuddySessionVisibility.private,
        code: await this.uniqueRoomCode(),
        groupId: scope === BuddySessionScope.group ? dto.groupId : null,
        creatorId: userId,
        activity: dto.activity?.trim() || null,
        subActivity: dto.subActivity?.trim() || null,
        expiresAt: this.roomExpiresAt(),
        participants: { create: { userId } },
      },
      include: this.roomInclude(),
    });
    return this.toRoom(room, true);
  }

  async joinRoom(userId: string, dto: JoinBuddyRoomDto) {
    const room = await this.ensureCanJoinRoom(userId, dto);
    return this.saveSession(userId, { roomId: room.id, latitude: dto.latitude, longitude: dto.longitude, ttlMinutes: DEFAULT_TTL_MINUTES }, room);
  }

  async inviteCandidates(userId: string, roomId: string, q = '') {
    const room = await this.ensureCanInviteRoom(userId, roomId);
    const where = await this.inviteCandidateWhere(userId, room, { q, excludeParticipants: true });
    const users = await this.prisma.user.findMany({
      where,
      take: 100,
      orderBy: [{ username: 'asc' }, { displayName: 'asc' }, { createdAt: 'desc' }],
      select: this.inviteUserSelect(),
    });
    return users.map((user) => exposeActivityPersonas(user));
  }

  async inviteRoom(userId: string, roomId: string, dto: InviteBuddyRoomDto) {
    const room = await this.ensureCanInviteRoom(userId, roomId);
    const recipientIds = [...new Set(dto.recipientIds)].filter((id) => id && id !== userId);
    if (!recipientIds.length) throw new BadRequestException('Select at least one person to invite.');
    const where = await this.inviteCandidateWhere(userId, room, { recipientIds, excludeParticipants: true });
    const recipients = await this.prisma.user.findMany({
      where,
      select: this.inviteUserSelect(),
    });
    if (recipients.length !== recipientIds.length) throw new ForbiddenException('One or more people cannot be invited to this buddy session.');
    const body = this.inviteMessage(room, dto.inviteUrl);
    const messages = [];
    for (const recipient of recipients) {
      messages.push(await this.prisma.message.create({
        data: { senderId: userId, recipientId: recipient.id, body },
        include: this.messageInclude(),
      }));
    }
    return {
      sent: messages.length,
      recipients: recipients.map((recipient) => exposeActivityPersonas(recipient)),
      messages,
    };
  }

  async roomMessages(userId: string, roomId: string) {
    await this.ensureActiveRoomParticipant(userId, roomId);
    const [messages, participants, readStates] = await Promise.all([
      this.prisma.buddySessionMessage.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: this.sessionMessageInclude(),
      }),
      this.prisma.buddyRoomParticipant.findMany({
        where: { roomId, kickedAt: null },
        select: {
          userId: true,
          joinedAt: true,
          user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
        },
      }),
      this.prisma.buddySessionReadState.findMany({
        where: { roomId },
        include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } },
      }),
    ]);
    const joinedMessageUserIds = new Set(messages.filter((message) => message.kind === BuddySessionMessageKind.joined).map((message) => message.senderId));
    const syntheticJoinedMessages = participants
      .filter((participant) => !joinedMessageUserIds.has(participant.userId))
      .map((participant) => ({
        id: `participant:${roomId}:${participant.userId}:joined`,
        roomId,
        senderId: participant.userId,
        kind: BuddySessionMessageKind.joined,
        body: BuddySessionMessageKind.joined,
        createdAt: participant.joinedAt,
        sender: participant.user,
      }));
    return [...messages.map((message) => this.toSessionMessage(message, readStates)), ...syntheticJoinedMessages]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-100);
  }

  async sendRoomMessage(userId: string, roomId: string, dto: SendBuddySessionMessageDto) {
    await this.ensureActiveRoomParticipant(userId, roomId);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Message cannot be empty.');
    const kind = dto.kind ?? BuddySessionMessageKind.text;
    const userMessageKinds: BuddySessionMessageKind[] = [BuddySessionMessageKind.text, BuddySessionMessageKind.gif, BuddySessionMessageKind.sticker];
    if (!userMessageKinds.includes(kind)) {
      throw new BadRequestException('Unsupported session message kind.');
    }
    if ((kind === BuddySessionMessageKind.gif || kind === BuddySessionMessageKind.sticker) && !this.isTrustedSessionMediaUrl(body)) {
      throw new BadRequestException('GIF or sticker message must use a trusted media URL.');
    }
    const message = await this.prisma.buddySessionMessage.create({
      data: { roomId, senderId: userId, kind, body },
      include: this.sessionMessageInclude(),
    });
    const payload = this.toSessionMessage(message);
    await this.emitRoomMessage(roomId, payload).catch(() => undefined);
    return payload;
  }

  async markRoomMessagesRead(userId: string, roomId: string) {
    await this.ensureActiveRoomParticipant(userId, roomId);
    const readAt = new Date();
    const [state, user] = await Promise.all([
      this.prisma.buddySessionReadState.upsert({
        where: { roomId_userId: { roomId, userId } },
        create: { roomId, userId, lastReadAt: readAt },
        update: { lastReadAt: readAt },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, displayName: true, username: true, profileImageUrl: true },
      }),
    ]);
    const payload = { roomId, userId, readAt: state.lastReadAt, user };
    await this.emitRoomRead(roomId, payload).catch(() => undefined);
    return { ok: true, ...payload };
  }

  async kickRoomParticipant(userId: string, roomId: string, targetUserId: string, dto: KickBuddyRoomParticipantDto = {}) {
    if (userId === targetUserId) throw new BadRequestException('You cannot kick yourself from the session.');
    const room = await this.prisma.buddyRoom.findUnique({
      where: { id: roomId },
      include: {
        participants: { select: { userId: true, kickedAt: true } },
      },
    });
    if (!room || room.expiresAt <= new Date()) throw new NotFoundException('Buddy session not found');
    if (room.creatorId !== userId) throw new ForbiddenException('Only the creator can kick people from this buddy session.');
    if (room.creatorId === targetUserId) throw new BadRequestException('The session creator cannot be kicked.');
    const participant = room.participants.find((item) => item.userId === targetUserId);
    if (!participant || participant.kickedAt) throw new NotFoundException('Participant not found in this buddy session.');
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, displayName: true, username: true, profileImageUrl: true },
    });
    if (!target) throw new NotFoundException('Participant not found.');
    const kickedAt = new Date();
    const reason = dto.reason?.trim() || null;
    const message = await this.prisma.$transaction(async (tx) => {
      await tx.buddyRoomParticipant.update({
        where: { roomId_userId: { roomId, userId: targetUserId } },
        data: { kickedAt, kickedById: userId },
      });
      await tx.buddySession.deleteMany({ where: { roomId, userId: targetUserId } });
      return tx.buddySessionMessage.create({
        data: { roomId, senderId: targetUserId, kind: BuddySessionMessageKind.kicked, body: reason || BuddySessionMessageKind.kicked },
        include: this.sessionMessageInclude(),
      });
    });
    await this.emitRoomMessage(roomId, this.toSessionMessage(message)).catch(() => undefined);
    await this.emitRoomKicked(roomId, targetUserId, target, userId, kickedAt).catch(() => undefined);
    await this.closeRoomIfNoActiveParticipants(roomId);
    return { ok: true };
  }

  async closeRoom(userId: string, roomId: string) {
    const room = await this.prisma.buddyRoom.findUnique({ where: { id: roomId }, select: { creatorId: true } });
    if (!room) throw new NotFoundException('Buddy session not found');
    if (room.creatorId !== userId) throw new ForbiddenException('Only the creator can close this buddy session.');
    await this.prisma.$transaction([
      this.prisma.buddySession.deleteMany({ where: { roomId } }),
      this.prisma.buddyRoomParticipant.deleteMany({ where: { roomId } }),
      this.prisma.buddyRoom.delete({ where: { id: roomId } }),
    ]);
    return { ok: true };
  }

  private async closeRoomIfNoActiveParticipants(roomId: string) {
    const activeParticipants = await this.prisma.buddySession.count({ where: { roomId, expiresAt: { gt: new Date() } } });
    if (activeParticipants > 0) return;
    await this.prisma.buddyRoom.deleteMany({ where: { id: roomId } }).catch(() => null);
  }

  private async closeInactiveRoomsForList(where: any, now = new Date()) {
    const staleRooms = await this.prisma.buddyRoom.findMany({
      where: {
        ...where,
        expiresAt: { lte: now },
        sessions: { none: { expiresAt: { gt: now } } },
      },
      select: { id: true },
    });
    if (!staleRooms.length) return;
    await this.prisma.buddyRoom.deleteMany({ where: { id: { in: staleRooms.map((room) => room.id) } } });
  }

  private async emitRoomJoined(userId: string, roomId: string, session: any) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const joinedAt = new Date().toISOString();
    const recipients = await this.prisma.buddySession.findMany({
      where: { roomId, userId: { not: userId }, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    const event = { id: `${roomId}:${userId}:${joinedAt}`, roomId, session, joinedAt };
    for (const recipient of recipients) realtime.emitToUser(recipient.userId, 'buddy:room-joined', event);
  }

  private async emitRoomLeft(userId: string, roomId: string) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const [recipients, user] = await Promise.all([
      this.prisma.buddySession.findMany({
        where: { roomId, userId: { not: userId }, expiresAt: { gt: new Date() } },
        select: { userId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, displayName: true, username: true, profileImageUrl: true },
      }),
    ]);
    if (!user) return;
    const leftAt = new Date().toISOString();
    const event = { id: `${roomId}:${userId}:left:${leftAt}`, roomId, userId, user, leftAt };
    for (const recipient of recipients) realtime.emitToUser(recipient.userId, 'buddy:room-left', event);
  }

  private async createRoomEventMessage(roomId: string, userId: string, kind: Extract<BuddySessionMessageKind, 'joined' | 'left' | 'kicked'>) {
    const message = await this.prisma.buddySessionMessage.create({
      data: { roomId, senderId: userId, kind, body: kind },
      include: this.sessionMessageInclude(),
    });
    const payload = this.toSessionMessage(message);
    await this.emitRoomMessage(roomId, payload).catch(() => undefined);
    return payload;
  }

  private async emitRoomMessage(roomId: string, message: any) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const recipients = await this.prisma.buddySession.findMany({
      where: { roomId, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    for (const recipient of recipients) realtime.emitToUser(recipient.userId, 'buddy:room-message', { roomId, message });
  }

  private async emitRoomRead(roomId: string, payload: any) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const recipients = await this.prisma.buddySession.findMany({
      where: { roomId, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    for (const recipient of recipients) realtime.emitToUser(recipient.userId, 'buddy:room-read', payload);
  }

  private async emitRoomKicked(roomId: string, userId: string, user: any, kickedById: string, kickedAt: Date) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const recipients = await this.prisma.buddySession.findMany({
      where: { roomId, userId: { not: userId }, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    const event = { id: `${roomId}:${userId}:kicked:${kickedAt.toISOString()}`, roomId, userId, user, kickedById, kickedAt: kickedAt.toISOString() };
    for (const recipient of recipients) realtime.emitToUser(recipient.userId, 'buddy:room-kicked', event);
    realtime.emitToUser(userId, 'buddy:room-kicked', event);
  }

  private scheduleExpiredDataCleanup() {
    const nowMs = Date.now();
    if (this.cleanupPromise || nowMs - this.lastCleanupAt < BUDDY_CLEANUP_INTERVAL_MS) return;
    this.lastCleanupAt = nowMs;
    this.cleanupPromise = this.cleanupExpiredBuddyData()
      .catch(() => undefined)
      .finally(() => { this.cleanupPromise = null; });
  }

  private async cleanupExpiredBuddyData() {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const expiredSessions = await tx.buddySession.findMany({
        where: { expiresAt: { lte: now } },
        select: { userId: true, roomId: true },
        take: 500,
      });
      for (const session of expiredSessions) {
        await tx.buddySession.deleteMany({ where: { userId: session.userId, expiresAt: { lte: now } } });
      }
      await tx.buddyRoom.deleteMany({
        where: {
          expiresAt: { lte: now },
          sessions: { none: { expiresAt: { gt: now } } },
        },
      });
    });
  }

  private notificationsGateway() {
    if (this.realtime !== undefined) return this.realtime;
    try {
      this.realtime = this.moduleRef.get(NotificationsGateway, { strict: false });
    } catch {
      this.realtime = null;
    }
    return this.realtime;
  }

  async activityOptions() {
    const options = await this.prisma.buddyActivityOption.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: { activity: true, label: true, subActivities: true },
    });
    if (options.length) {
      return options.map((option) => ({
        value: option.activity,
        label: option.label,
        subActivities: option.subActivities,
      }));
    }
    return [];
  }

  private async ensureActivityOption(activity?: string | null) {
    const trimmed = activity?.trim();
    if (!trimmed) return;
    const option = await this.prisma.buddyActivityOption.findFirst({
      where: { activity: trimmed, enabled: true },
      select: { activity: true },
    });
    if (!option) throw new BadRequestException('Unknown buddy activity.');
  }

  private async ensureCanJoinRoom(userId: string, dto: { roomId?: string; code?: string }) {
    if (!dto.roomId && !dto.code) throw new BadRequestException('Room ID or code is required.');
    const room = await this.prisma.buddyRoom.findFirst({
      where: dto.roomId ? { id: dto.roomId } : { code: dto.code?.trim().toUpperCase() },
      include: this.roomInclude(),
    });
    if (!room || room.expiresAt <= new Date()) throw new NotFoundException('Buddy session not found');
    if (room.scope === BuddySessionScope.group) await this.ensureGroupMember(userId, room.groupId!);
    if (this.isKickedFromRoom(userId, room)) throw new ForbiddenException('You were removed from this buddy session.');
    if (room.visibility === BuddySessionVisibility.private && !this.canAccessPrivateRoom(userId, room) && dto.code?.trim().toUpperCase() !== room.code) {
      throw new ForbiddenException('Enter the buddy session code to join.');
    }
    return room;
  }

  private async ensureCanInviteRoom(userId: string, roomId: string) {
    const room = await this.prisma.buddyRoom.findUnique({
      where: { id: roomId },
      include: this.roomInclude(),
    });
    if (!room || room.expiresAt <= new Date()) throw new NotFoundException('Buddy session not found');
    if (room.creatorId !== userId) throw new ForbiddenException('Only the creator can send direct invites.');
    return room;
  }

  private async ensureActiveRoomParticipant(userId: string, roomId: string) {
    const session = await this.prisma.buddySession.findFirst({
      where: { userId, roomId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) throw new ForbiddenException('Join this buddy session first.');
  }

  private async inviteCandidateWhere(userId: string, room: any, options: { q?: string; recipientIds?: string[]; excludeParticipants?: boolean } = {}) {
    const filters: any[] = [
      { id: { not: userId } },
      { followers: { some: { followerId: userId } } },
      { following: { some: { followingId: userId } } },
      { blocksSent: { none: { blockedId: userId } } },
      { blocksReceived: { none: { blockerId: userId } } },
    ];
    const blocked = await this.blockedUserIds(userId);
    if (blocked.length) filters.push({ id: { notIn: blocked } });
    if (options.excludeParticipants) filters.push({ buddyRoomParticipants: { none: { roomId: room.id, kickedAt: null } } });
    if (room.scope === BuddySessionScope.group) filters.push({ groupMembers: { some: { groupId: room.groupId } } });
    if (options.recipientIds?.length) filters.push({ id: { in: options.recipientIds } });
    const q = options.q?.trim();
    if (q) {
      filters.push({
        OR: [
          { username: { contains: q.replace(/^@/, '').toLowerCase(), mode: 'insensitive' as const } },
          { displayName: { contains: q, mode: 'insensitive' as const } },
        ],
      });
    }
    return { AND: filters };
  }

  private inviteMessage(room: any, inviteUrl?: string) {
    const groupContext = room.scope === BuddySessionScope.group && room.group?.name ? ` in ${room.group.name}` : '';
    const lines = [
      `You're invited to join "${room.name}"${groupContext} on SweBudd.`,
      `Code: ${room.code}`,
    ];
    const trustedUrl = this.trustedInviteUrl(room, inviteUrl);
    if (trustedUrl) lines.push(`Open: ${trustedUrl}`);
    return lines.join('\n');
  }

  private trustedInviteUrl(room: any, inviteUrl?: string) {
    if (!inviteUrl) return '';
    try {
      const parsed = new URL(inviteUrl, 'https://swebudd.local');
      if (parsed.pathname !== this.invitePath(room)) return '';
      if (parsed.searchParams.get('code') !== room.code) return '';
      return inviteUrl;
    } catch {
      return '';
    }
  }

  private invitePath(room: any) {
    if (room.scope === BuddySessionScope.group && room.group?.slug) {
      return `/groups/${encodeURIComponent(room.group.slug)}/buddy-sessions/${encodeURIComponent(room.id)}`;
    }
    return `/buddy-sessions/${encodeURIComponent(room.id)}`;
  }

  private canAccessPrivateRoom(userId: string, room: any) {
    return room.creatorId === userId || Boolean(room.participants?.some((participant: { userId: string; kickedAt?: Date | string | null }) => participant.userId === userId && !participant.kickedAt));
  }

  private isKickedFromRoom(userId: string, room: any) {
    return Boolean(room.participants?.some((participant: { userId: string; kickedAt?: Date | string | null }) => participant.userId === userId && participant.kickedAt));
  }

  private canRevealRoomCode(userId: string, room: any) {
    return room.creatorId === userId;
  }

  private isTrustedSessionMediaUrl(value: string) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && /\.(gif|png|jpe?g|webp|avif)(\?.*)?$/i.test(parsed.href);
    } catch {
      return false;
    }
  }

  private activeRoomSessionCount(roomId: string) {
    return this.prisma.buddySession.count({ where: { roomId, expiresAt: { gt: new Date() } } });
  }

  private roomExpiresAt() {
    return new Date(Date.now() + ROOM_INACTIVITY_MS);
  }

  private async defaultRoomName(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    return `@${user?.username || 'buddy'}'s session`;
  }

  private nearbyBoundsWhere(lat: number, lng: number, radiusKm: number) {
    const latDelta = radiusKm / 111.32;
    const minLat = Math.max(-90, lat - latDelta);
    const maxLat = Math.min(90, lat + latDelta);
    const cosLat = Math.cos(lat * Math.PI / 180);
    const lngDelta = Math.abs(cosLat) < 0.01 ? 180 : radiusKm / (111.32 * Math.abs(cosLat));
    if (lngDelta >= 180) return { latitude: { gte: minLat, lte: maxLat } };

    const minLng = this.normalizeLongitude(lng - lngDelta);
    const maxLng = this.normalizeLongitude(lng + lngDelta);
    const longitude = minLng <= maxLng
      ? { longitude: { gte: minLng, lte: maxLng } }
      : { OR: [{ longitude: { gte: minLng } }, { longitude: { lte: maxLng } }] };
    return { latitude: { gte: minLat, lte: maxLat }, ...longitude };
  }

  private normalizeLongitude(value: number) {
    return ((((value + 180) % 360) + 360) % 360) - 180;
  }

  private async ensureGroupMember(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException('Join the group first.');
  }

  private async blockedUserIds(userId: string) {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    return rows.map((row) => row.blockerId === userId ? row.blockedId : row.blockerId);
  }

  private async uniqueRoomCode() {
    for (let i = 0; i < 8; i += 1) {
      const code = randomBytes(4).toString('hex').toUpperCase();
      const exists = await this.prisma.buddyRoom.findUnique({ where: { code }, select: { id: true } });
      if (!exists) return code;
    }
    throw new BadRequestException('Could not create invite code. Try again.');
  }

  private toBuddy(session: any, lat: number, lng: number) {
    const age = session.user.dateOfBirth ? this.ageFromDate(session.user.dateOfBirth) : null;
    return {
      id: session.id,
      userId: session.userId,
      roomId: session.roomId,
      room: session.room ? this.toRoom(session.room, this.canRevealRoomCode(session.userId, session.room)) : null,
      activity: session.activity,
      subActivity: session.subActivity,
      note: session.note,
      visibleTo: session.visibleTo,
      canSee: session.canSee,
      latitude: session.latitude,
      longitude: session.longitude,
      expiresAt: session.expiresAt,
      updatedAt: session.updatedAt,
      distanceKm: this.distanceKm(lat, lng, session.latitude, session.longitude),
      user: { ...exposeActivityPersonas(session.user), dateOfBirth: undefined, age },
    };
  }

  private toRoom(room: any, revealCode = false) {
    return {
      id: room.id,
      name: room.name,
      scope: room.scope,
      visibility: room.visibility,
      code: revealCode || room.visibility === BuddySessionVisibility.public ? room.code : undefined,
      groupId: room.groupId,
      group: room.group,
      creatorId: room.creatorId,
      creator: room.creator,
      activity: room.activity,
      subActivity: room.subActivity,
      expiresAt: room.expiresAt,
      createdAt: room.createdAt,
      participantCount: room._count?.sessions ?? 0,
    };
  }

  private toSessionMessage(message: any, readStates: any[] = []) {
    return {
      id: message.id,
      roomId: message.roomId,
      senderId: message.senderId,
      kind: message.kind,
      body: message.body,
      createdAt: message.createdAt,
      sender: message.sender,
      readBy: readStates
        .filter((state) => state.userId !== message.senderId && state.lastReadAt >= message.createdAt)
        .map((state) => ({
          userId: state.userId,
          readAt: state.lastReadAt,
          user: state.user,
        })),
    };
  }

  private sessionInclude() {
    return { user: { select: this.userSelect() }, room: { include: this.roomInclude() } } as const;
  }

  private visibleToViewerWhere(viewerId: string) {
    return {
      OR: [
        { visibleTo: BuddyDiscoveryAudience.public },
        {
          visibleTo: BuddyDiscoveryAudience.mutuals,
          user: {
            followers: { some: { followerId: viewerId } },
            following: { some: { followingId: viewerId } },
          },
        },
        {
          visibleTo: BuddyDiscoveryAudience.close_buddies,
          user: { closeBuddies: { some: { buddyId: viewerId } } },
        },
      ],
    };
  }

  private viewerCanSeeWhere(viewerId: string, audience: BuddyDiscoveryAudience) {
    if (audience === BuddyDiscoveryAudience.mutuals) {
      return {
        user: {
          followers: { some: { followerId: viewerId } },
          following: { some: { followingId: viewerId } },
        },
      };
    }
    if (audience === BuddyDiscoveryAudience.close_buddies) {
      return { user: { closeBuddyOf: { some: { ownerId: viewerId } } } };
    }
    return {};
  }

  private roomInclude(now = new Date()) {
    return {
      group: { select: { id: true, name: true, slug: true } },
      creator: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      participants: { select: { userId: true, kickedAt: true } },
      _count: { select: { sessions: { where: { expiresAt: { gt: now } } } } },
    } as const;
  }

  private ageFromDate(value: Date) {
    const now = new Date();
    let age = now.getFullYear() - value.getFullYear();
    const monthDelta = now.getMonth() - value.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < value.getDate())) age -= 1;
    return age;
  }

  private distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
    const toRad = (value: number) => value * Math.PI / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private userSelect() {
    return { id: true, displayName: true, username: true, profileImageUrl: true, gender: true, dateOfBirth: true, activityPersonas: activityPersonaLinkSelect } as const;
  }

  private inviteUserSelect() {
    return { id: true, displayName: true, username: true, profileImageUrl: true, activityPersonas: activityPersonaLinkSelect } as const;
  }

  private messageInclude() {
    return {
      sender: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      recipient: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      reactions: true,
    } as const;
  }

  private sessionMessageInclude() {
    return {
      sender: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
    } as const;
  }
}
