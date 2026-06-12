import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomBytes } from 'crypto';
import { BuddyDiscoveryAudience, BuddyRoomParticipantRole, BuddySessionMessageKind, BuddySessionScope, BuddySessionVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BuddyRoomQueryDto, BuddySessionMessageReactionDto, CreateBuddyRoomDto, DiscoverableBuddyQueryDto, InviteBuddyRoomDto, JoinBuddyRoomDto, KickBuddyRoomParticipantDto, NearbyBuddyQueryDto, SendBuddySessionMessageDto, UpdateBuddyRoomParticipantRoleDto, UpsertBuddySessionDto } from './dto';
import { activityPersonaLinkSelect, exposeActivityPersonas } from '../common/activity-personas';
import { NotificationsGateway } from '../notifications/notifications.gateway';

const DEFAULT_TTL_MINUTES = 60;
const ROOM_OWNER_INACTIVITY_MS = 5 * 60 * 60_000;
const DEFAULT_RADIUS_KM = 5;
const DEFAULT_TAKE = 50;
const DEFAULT_DISCOVERABLE_TAKE = 250;
const MAX_DISCOVERABLE_TAKE = 500;
const BUDDY_CLEANUP_INTERVAL_MS = 5 * 60_000;
const ROOM_LOCATION_EVENT_MIN_INTERVAL_MS = 1_000;
const DISCOVERY_SESSION_EVENT_MIN_INTERVAL_MS = 2_000;

@Injectable()
export class BuddyService {
  private realtime: NotificationsGateway | null | undefined;
  private cleanupPromise: Promise<void> | null = null;
  private lastCleanupAt = 0;
  private roomLocationEventAt = new Map<string, number>();
  private discoverySessionEventAt = new Map<string, number>();

  constructor(private prisma: PrismaService, private moduleRef: ModuleRef) {}

  async me(userId: string) {
    this.scheduleExpiredDataCleanup();
    const now = new Date();
    const session = await this.prisma.buddySession.findUnique({ where: { userId }, include: this.sessionInclude() });
    if (!session) return null;
    if (session.expiresAt <= now) {
      await this.expireUserSession(userId, session);
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
    const now = new Date();
    const previousSession = await this.prisma.buddySession.findUnique({ where: { userId }, select: { roomId: true, expiresAt: true, latitude: true, longitude: true } });
    const wasActiveInRoom = Boolean(room?.id && previousSession && previousSession.roomId === room.id && previousSession.expiresAt > now);
    const ttlMinutes = Math.min(Math.max(dto.ttlMinutes ?? DEFAULT_TTL_MINUTES, 5), 120);
    const expiresAt = room?.id ? this.roomExpiresAt(now) : new Date(now.getTime() + ttlMinutes * 60_000);
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
        const participant = await tx.buddyRoomParticipant.upsert({
          where: { roomId_userId: { roomId: room.id, userId } },
          create: {
            roomId: room.id,
            userId,
            role: room.creatorId === userId ? BuddyRoomParticipantRole.owner : BuddyRoomParticipantRole.member,
            lastActivityAt: now,
          },
          update: { leftAt: null, kickedAt: null, kickedById: null, lastActivityAt: now },
          select: { role: true },
        });
        if (this.isRoomOwnerRole(participant.role)) {
          await tx.buddyRoom.updateMany({ where: { id: room.id }, data: { expiresAt: this.roomExpiresAt(now) } });
        }
      }
      return saved;
    });
    if (previousSession?.roomId && previousSession.roomId !== room?.id) {
      await this.emitRoomLeft(userId, previousSession.roomId).catch(() => undefined);
      await this.closeRoomIfNoActiveManagers(previousSession.roomId);
      await this.closeRoomIfOwnersInactive(previousSession.roomId);
    }
    if (previousSession && !previousSession.roomId && room?.id) {
      await this.emitDiscoverySessionStopped(userId, previousSession).catch(() => undefined);
    }
    const buddy = this.toBuddy(session, dto.latitude, dto.longitude);
    if (room?.id && !wasActiveInRoom) {
      await this.createRoomEventMessage(room.id, userId, BuddySessionMessageKind.joined).catch(() => undefined);
      await this.emitRoomJoined(userId, room.id, buddy).catch(() => undefined);
    } else if (room?.id && wasActiveInRoom) {
      await this.emitRoomLocationUpdated(userId, room.id, buddy).catch(() => undefined);
    } else if (!room?.id) {
      await this.emitDiscoverySessionUpdated(userId, buddy).catch(() => undefined);
    }
    return buddy;
  }

  async stop(userId: string) {
    const session = await this.prisma.buddySession.findUnique({ where: { userId }, select: { roomId: true, latitude: true, longitude: true } });
    const leftAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.buddySession.deleteMany({ where: { userId } });
      if (session?.roomId) {
        await tx.buddyRoomParticipant.updateMany({
          where: { roomId: session.roomId, userId, kickedAt: null },
          data: { leftAt, lastActivityAt: leftAt },
        });
      }
    });
    if (session?.roomId) {
      await this.createRoomEventMessage(session.roomId, userId, BuddySessionMessageKind.left).catch(() => undefined);
      await this.emitRoomLeft(userId, session.roomId).catch(() => undefined);
      await this.closeRoomIfNoActiveManagers(session.roomId);
      await this.closeRoomIfOwnersInactive(session.roomId);
    } else if (session) {
      await this.emitDiscoverySessionStopped(userId, session).catch(() => undefined);
    }
    return { ok: true };
  }

  async stopPresence(userId: string) {
    const session = await this.prisma.buddySession.findUnique({ where: { userId }, select: { roomId: true, latitude: true, longitude: true } });
    if (!session) return { ok: true };
    await this.expireUserSession(userId, session);
    return { ok: true };
  }

  private async expireUserSession(userId: string, session: { roomId: string | null; latitude: number; longitude: number }) {
    const leftAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.buddySession.deleteMany({ where: { userId } });
      if (session.roomId) {
        await tx.buddyRoomParticipant.updateMany({
          where: { roomId: session.roomId, userId, kickedAt: null },
          data: { leftAt, lastActivityAt: leftAt },
        });
      }
    });
    if (session.roomId) {
      await this.emitRoomPresenceStopped(userId, session.roomId).catch(() => undefined);
      await this.closeRoomIfNoActiveManagers(session.roomId);
      await this.closeRoomIfOwnersInactive(session.roomId);
      return;
    }
    await this.emitDiscoverySessionStopped(userId, session).catch(() => undefined);
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
      include: this.buddySessionInclude(),
      orderBy: { updatedAt: 'desc' },
      take: 250,
    });
    const sorted = sessions
      .map((session) => this.toBuddy(session, query.lat, query.lng))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    return room ? sorted : sorted.filter((session) => session.distanceKm <= radiusKm).slice(0, take);
  }

  async discoverable(userId: string, query: DiscoverableBuddyQueryDto) {
    this.scheduleExpiredDataCleanup();
    const queryActivity = query.activity?.trim() || null;
    await this.ensureActivityOption(queryActivity);
    const now = new Date();
    const radiusKm = query.radiusKm;
    if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm)) {
      throw new BadRequestException('radiusKm is required for buddy discovery.');
    }
    const take = Math.min(Math.max(query.take ?? DEFAULT_DISCOVERABLE_TAKE, 1), MAX_DISCOVERABLE_TAKE);
    const blocked = await this.blockedUserIds(userId);
    const viewerSession = await this.prisma.buddySession.findUnique({ where: { userId }, select: { canSee: true, expiresAt: true } });
    const canSee = viewerSession && viewerSession.expiresAt > now ? viewerSession.canSee : BuddyDiscoveryAudience.public;
    const sessions = await this.prisma.buddySession.findMany({
      where: {
        userId: { not: userId, notIn: blocked },
        roomId: null,
        ...(queryActivity ? { activity: queryActivity } : {}),
        expiresAt: { gt: now },
        ...this.nearbyBoundsWhere(query.lat, query.lng, radiusKm),
        AND: [
          this.visibleToViewerWhere(userId),
          this.viewerCanSeeWhere(userId, canSee),
        ],
      },
      include: this.buddySessionInclude(),
      orderBy: { updatedAt: 'desc' },
      take,
    });
    return sessions
      .map((session) => this.toBuddy(session, query.lat, query.lng))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .filter((session) => session.distanceKm <= radiusKm)
      .slice(0, take);
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
      baseWhere.participants = { some: { userId, kickedAt: null, leftAt: null } };
    }
    baseWhere.NOT = { participants: { some: { userId, kickedAt: { not: null } } } };
    await this.closeInactiveRoomsForList(baseWhere, now);
    const rooms = await this.prisma.buddyRoom.findMany({ where: baseWhere, orderBy: { createdAt: 'desc' }, include: this.roomListInclude(now) });
    return rooms.map((room) => this.toRoomSummary(room, this.canRevealRoomCode(userId, room)));
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
    const now = new Date();
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
        expiresAt: this.roomExpiresAt(now),
        participants: { create: { userId, role: BuddyRoomParticipantRole.owner, lastActivityAt: now } },
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
    const body = this.inviteMessage(room);
    const messages = [];
    for (const recipient of recipients) {
      messages.push(await this.prisma.message.create({
        data: { senderId: userId, recipientId: recipient.id, body },
        include: this.messageInclude(),
      }));
    }
    await this.touchRoomParticipantActivity(this.prisma, roomId, userId);
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
        where: { roomId, hiddenBy: { none: { userId } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: this.sessionMessageInclude(),
      }),
      this.prisma.buddyRoomParticipant.findMany({
        where: { roomId, kickedAt: null, leftAt: null },
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
    const userMessageKinds: BuddySessionMessageKind[] = [BuddySessionMessageKind.text, BuddySessionMessageKind.gif];
    if (!userMessageKinds.includes(kind)) {
      throw new BadRequestException('Unsupported session message kind.');
    }
    if (kind === BuddySessionMessageKind.gif && !this.isTrustedSessionGifUrl(body)) {
      throw new BadRequestException('GIF message must use a trusted GIF URL.');
    }
    const message = await this.prisma.buddySessionMessage.create({
      data: { roomId, senderId: userId, kind, body, ...await this.roomMessageReferenceData(roomId, dto) },
      include: this.sessionMessageInclude(),
    });
    const payload = this.toSessionMessage(message);
    await this.touchRoomParticipantActivity(this.prisma, roomId, userId);
    await this.emitRoomMessage(roomId, payload).catch(() => undefined);
    return payload;
  }

  async reactToRoomMessage(userId: string, roomId: string, messageId: string, dto: BuddySessionMessageReactionDto) {
    const emoji = this.allowedReaction(dto.emoji);
    await this.ensureCanAccessRoomMessage(userId, roomId, messageId);
    await this.prisma.$transaction([
      this.prisma.buddySessionMessageReaction.deleteMany({ where: { messageId, userId } }),
      this.prisma.buddySessionMessageReaction.create({ data: { messageId, userId, emoji } }),
    ]);
    await this.touchRoomParticipantActivity(this.prisma, roomId, userId);
    return this.emitUpdatedRoomMessage(roomId, messageId);
  }

  async unreactToRoomMessage(userId: string, roomId: string, messageId: string, emoji: string) {
    await this.ensureCanAccessRoomMessage(userId, roomId, messageId);
    await this.prisma.buddySessionMessageReaction.deleteMany({ where: { messageId, userId, emoji } });
    await this.touchRoomParticipantActivity(this.prisma, roomId, userId);
    return this.emitUpdatedRoomMessage(roomId, messageId);
  }

  async unsendRoomMessage(userId: string, roomId: string, messageId: string) {
    const message = await this.ensureCanAccessRoomMessage(userId, roomId, messageId);
    if (message.senderId !== userId) throw new ForbiddenException('Only the sender can unsend this message.');
    await this.prisma.buddySessionMessageReaction.deleteMany({ where: { messageId } });
    const updated = await this.prisma.buddySessionMessage.update({
      where: { id: messageId },
      data: {
        body: '',
        referenceType: null,
        referenceId: null,
        referenceText: null,
        referenceAuthorName: null,
        deletedAt: new Date(),
        deletedById: userId,
      },
      include: this.sessionMessageInclude(),
    });
    const payload = this.toSessionMessage(updated);
    await this.touchRoomParticipantActivity(this.prisma, roomId, userId);
    await this.emitRoomMessage(roomId, payload).catch(() => undefined);
    return payload;
  }

  async deleteRoomMessage(userId: string, roomId: string, messageId: string) {
    await this.ensureCanAccessRoomMessage(userId, roomId, messageId);
    await this.prisma.buddySessionHiddenMessage.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId },
      update: {},
    });
    await this.touchRoomParticipantActivity(this.prisma, roomId, userId);
    return { ok: true };
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
    await this.touchRoomParticipantActivity(this.prisma, roomId, userId);
    await this.emitRoomRead(roomId, payload).catch(() => undefined);
    return { ok: true, ...payload };
  }

  async kickRoomParticipant(userId: string, roomId: string, targetUserId: string, dto: KickBuddyRoomParticipantDto = {}) {
    if (userId === targetUserId) throw new BadRequestException('You cannot kick yourself from the session.');
    const room = await this.prisma.buddyRoom.findUnique({
      where: { id: roomId },
      include: {
        participants: { select: { userId: true, role: true, leftAt: true, kickedAt: true } },
      },
    });
    if (!room || room.expiresAt <= new Date()) throw new NotFoundException('Buddy session not found');
    const requester = this.activeRoomParticipant(room, userId);
    if (!this.canManageRoom(requester?.role)) throw new ForbiddenException('Only session owners and admins can kick people from this buddy session.');
    if (room.creatorId === targetUserId) throw new BadRequestException('The session owner cannot be kicked.');
    const participant = room.participants.find((item) => item.userId === targetUserId);
    if (!participant || participant.leftAt || participant.kickedAt) throw new NotFoundException('Participant not found in this buddy session.');
    if (participant.role === BuddyRoomParticipantRole.owner) throw new BadRequestException('The session owner cannot be kicked.');
    if (participant.role === BuddyRoomParticipantRole.admin && requester?.role !== BuddyRoomParticipantRole.owner) {
      throw new ForbiddenException('Only the session owner can kick admins.');
    }
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
      await this.touchRoomParticipantActivity(tx, roomId, userId, kickedAt);
      return tx.buddySessionMessage.create({
        data: { roomId, senderId: targetUserId, kind: BuddySessionMessageKind.kicked, body: reason || BuddySessionMessageKind.kicked },
        include: this.sessionMessageInclude(),
      });
    });
    await this.emitRoomMessage(roomId, this.toSessionMessage(message)).catch(() => undefined);
    await this.emitRoomKicked(roomId, targetUserId, target, userId, kickedAt).catch(() => undefined);
    await this.closeRoomIfOwnersInactive(roomId);
    return { ok: true };
  }

  async updateRoomParticipantRole(userId: string, roomId: string, targetUserId: string, dto: UpdateBuddyRoomParticipantRoleDto) {
    if (userId === targetUserId) throw new BadRequestException('You cannot change your own session role.');
    const room = await this.prisma.buddyRoom.findUnique({
      where: { id: roomId },
      include: {
        participants: { select: { userId: true, role: true, leftAt: true, kickedAt: true } },
      },
    });
    if (!room || room.expiresAt <= new Date()) throw new NotFoundException('Buddy session not found');
    const requester = this.activeRoomParticipant(room, userId);
    if (requester?.role !== BuddyRoomParticipantRole.owner) throw new ForbiddenException('Only the session owner can assign admins.');
    if (room.creatorId === targetUserId) throw new BadRequestException('The session owner role cannot be changed.');
    const participant = room.participants.find((item) => item.userId === targetUserId);
    if (!participant || participant.leftAt || participant.kickedAt) throw new NotFoundException('Participant not found in this buddy session.');
    if (participant.role === BuddyRoomParticipantRole.owner) throw new BadRequestException('The session owner role cannot be changed.');
    const role = dto.role === BuddyRoomParticipantRole.admin ? BuddyRoomParticipantRole.admin : BuddyRoomParticipantRole.member;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.buddyRoomParticipant.update({
        where: { roomId_userId: { roomId, userId: targetUserId } },
        data: { role },
      });
      await this.touchRoomParticipantActivity(tx, roomId, userId);
      return tx.buddyRoom.findUniqueOrThrow({
        where: { id: roomId },
        include: this.roomInclude(),
      });
    });
    return this.toRoom(updated, true);
  }

  async closeRoom(userId: string, roomId: string) {
    const room = await this.prisma.buddyRoom.findUnique({
      where: { id: roomId },
      include: { participants: { select: { userId: true, role: true, leftAt: true, kickedAt: true } } },
    });
    if (!room) throw new NotFoundException('Buddy session not found');
    const requester = this.activeRoomParticipant(room, userId);
    if (!this.canManageRoom(requester?.role)) throw new ForbiddenException('Only session owners and admins can close this buddy session.');
    await this.deleteRoom(roomId);
    return { ok: true };
  }

  private async closeRoomIfOwnersInactive(roomId: string) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - ROOM_OWNER_INACTIVITY_MS);
    const staleRoom = await this.prisma.buddyRoom.findFirst({
      where: {
        id: roomId,
        expiresAt: { lte: now },
        participants: {
          none: {
            kickedAt: null,
            leftAt: null,
            role: { in: [BuddyRoomParticipantRole.owner, BuddyRoomParticipantRole.admin] },
            lastActivityAt: { gt: cutoff },
          },
        },
      },
      select: { id: true },
    }).catch(() => null);
    if (staleRoom) await this.deleteRoom(staleRoom.id).catch(() => undefined);
  }

  private async closeRoomIfNoActiveManagers(roomId: string) {
    const now = new Date();
    const managers = await this.prisma.buddyRoomParticipant.findMany({
      where: {
        roomId,
        kickedAt: null,
        leftAt: null,
        role: { in: [BuddyRoomParticipantRole.owner, BuddyRoomParticipantRole.admin] },
      },
      select: { userId: true },
    }).catch(() => []);
    if (!managers.length) {
      await this.deleteRoom(roomId).catch(() => undefined);
      return;
    }
    const activeManagerCount = await this.prisma.buddySession.count({
      where: {
        roomId,
        userId: { in: managers.map((manager) => manager.userId) },
        expiresAt: { gt: now },
      },
    }).catch(() => 0);
    if (activeManagerCount === 0) await this.deleteRoom(roomId).catch(() => undefined);
  }

  private async deleteRoom(roomId: string) {
    const [recipients, endedAt] = await Promise.all([
      this.prisma.buddySession.findMany({
        where: { roomId, expiresAt: { gt: new Date() } },
        select: { userId: true },
      }).catch(() => []),
      Promise.resolve(new Date()),
    ]);
    await this.prisma.$transaction([
      this.prisma.buddySession.deleteMany({ where: { roomId } }),
      this.prisma.buddyRoomParticipant.deleteMany({ where: { roomId } }),
      this.prisma.buddyRoom.delete({ where: { id: roomId } }),
    ]);
    await this.emitRoomClosed(roomId, recipients.map((recipient) => recipient.userId), endedAt).catch(() => undefined);
  }

  private async closeInactiveRoomsForList(where: any, now = new Date()) {
    const cutoff = new Date(now.getTime() - ROOM_OWNER_INACTIVITY_MS);
    const staleRooms = await this.prisma.buddyRoom.findMany({
      where: {
        ...where,
        expiresAt: { lte: now },
        participants: {
          none: {
            kickedAt: null,
            leftAt: null,
            role: { in: [BuddyRoomParticipantRole.owner, BuddyRoomParticipantRole.admin] },
            lastActivityAt: { gt: cutoff },
          },
        },
      },
      select: { id: true },
    });
    if (!staleRooms.length) return;
    for (const room of staleRooms) await this.deleteRoom(room.id).catch(() => undefined);
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

  private async emitRoomLocationUpdated(userId: string, roomId: string, session: any) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const throttleKey = `${roomId}:${userId}`;
    const nowMs = Date.now();
    const lastEmitAt = this.roomLocationEventAt.get(throttleKey) ?? 0;
    if (nowMs - lastEmitAt < ROOM_LOCATION_EVENT_MIN_INTERVAL_MS) return;
    this.roomLocationEventAt.set(throttleKey, nowMs);
    const recipients = await this.prisma.buddySession.findMany({
      where: { roomId, userId: { not: userId }, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    const updatedAt = new Date().toISOString();
    const event = {
      id: `${roomId}:${userId}:location:${updatedAt}`,
      roomId,
      userId,
      latitude: session.latitude,
      longitude: session.longitude,
      session,
      updatedAt,
    };
    for (const recipient of recipients) realtime.emitToUser(recipient.userId, 'buddy:room-location-updated', event);
  }

  private async emitRoomPresenceStopped(userId: string, roomId: string) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const recipients = await this.prisma.buddySession.findMany({
      where: { roomId, userId: { not: userId }, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    const stoppedAt = new Date().toISOString();
    const event = { id: `${roomId}:${userId}:presence-stopped:${stoppedAt}`, roomId, userId, stoppedAt };
    for (const recipient of recipients) realtime.emitToUser(recipient.userId, 'buddy:room-presence-stopped', event);
  }

  private async emitDiscoverySessionUpdated(userId: string, session: any) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const nowMs = Date.now();
    const lastEmitAt = this.discoverySessionEventAt.get(userId) ?? 0;
    if (nowMs - lastEmitAt < DISCOVERY_SESSION_EVENT_MIN_INTERVAL_MS) return;
    this.discoverySessionEventAt.set(userId, nowMs);

    const now = new Date();
    const candidates = await this.prisma.buddySession.findMany({
      where: {
        userId: { not: userId },
        roomId: null,
        expiresAt: { gt: now },
        ...this.nearbyBoundsWhere(session.latitude, session.longitude, DEFAULT_RADIUS_KM),
      },
      select: { userId: true, latitude: true, longitude: true, canSee: true },
      take: 250,
    });
    const updatedAt = new Date().toISOString();
    for (const candidate of candidates) {
      const blocked = await this.blockedUserIds(candidate.userId);
      if (blocked.includes(userId)) continue;
      const visibleSession = await this.prisma.buddySession.findFirst({
        where: {
          userId,
          roomId: null,
          expiresAt: { gt: now },
          AND: [
            this.visibleToViewerWhere(candidate.userId),
            this.viewerCanSeeWhere(candidate.userId, candidate.canSee),
          ],
        },
        include: this.buddySessionInclude(),
      });
      if (!visibleSession) continue;
      const buddy = this.toBuddy(visibleSession, candidate.latitude, candidate.longitude);
      if (buddy.distanceKm > DEFAULT_RADIUS_KM) continue;
      realtime.emitToUser(candidate.userId, 'buddy:discovery-session-updated', {
        id: `discovery:${userId}:${updatedAt}`,
        userId,
        session: buddy,
        updatedAt,
      });
    }
  }

  private async emitDiscoverySessionStopped(userId: string, session: { latitude: number; longitude: number }) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const now = new Date();
    const recipients = await this.prisma.buddySession.findMany({
      where: {
        userId: { not: userId },
        roomId: null,
        expiresAt: { gt: now },
        ...this.nearbyBoundsWhere(session.latitude, session.longitude, DEFAULT_RADIUS_KM),
      },
      select: { userId: true, latitude: true, longitude: true },
      take: 250,
    });
    const stoppedAt = new Date().toISOString();
    for (const recipient of recipients) {
      const blocked = await this.blockedUserIds(recipient.userId);
      if (blocked.includes(userId)) continue;
      if (this.distanceKm(recipient.latitude, recipient.longitude, session.latitude, session.longitude) > DEFAULT_RADIUS_KM) continue;
      realtime.emitToUser(recipient.userId, 'buddy:discovery-session-stopped', {
        id: `discovery:${userId}:stopped:${stoppedAt}`,
        userId,
        stoppedAt,
      });
    }
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

  private async emitRoomClosed(roomId: string, userIds: string[], endedAt: Date) {
    const realtime = this.notificationsGateway();
    if (!realtime) return;
    const uniqueUserIds = [...new Set(userIds)];
    const event = { id: `${roomId}:closed:${endedAt.toISOString()}`, roomId, endedAt: endedAt.toISOString() };
    for (const userId of uniqueUserIds) realtime.emitToUser(userId, 'buddy:room-closed', event);
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
    });
    await this.closeInactiveRoomsForList({}, now);
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
    if (!this.canManageRoom(this.activeRoomParticipant(room, userId)?.role)) throw new ForbiddenException('Only session owners and admins can send direct invites.');
    return room;
  }

  private async ensureActiveRoomParticipant(userId: string, roomId: string) {
    const session = await this.prisma.buddySession.findFirst({
      where: { userId, roomId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) throw new ForbiddenException('Join this buddy session first.');
  }

  private async ensureCanAccessRoomMessage(userId: string, roomId: string, messageId: string) {
    await this.ensureActiveRoomParticipant(userId, roomId);
    const message = await this.prisma.buddySessionMessage.findUniqueOrThrow({
      where: { id: messageId },
      select: { id: true, roomId: true, senderId: true, kind: true },
    });
    if (message.roomId !== roomId) throw new ForbiddenException();
    if (message.kind === BuddySessionMessageKind.joined || message.kind === BuddySessionMessageKind.left || message.kind === BuddySessionMessageKind.kicked) {
      throw new BadRequestException('Session event messages cannot be changed.');
    }
    return message;
  }

  private async emitUpdatedRoomMessage(roomId: string, messageId: string) {
    const message = await this.prisma.buddySessionMessage.findUniqueOrThrow({ where: { id: messageId }, include: this.sessionMessageInclude() });
    const payload = this.toSessionMessage(message);
    await this.emitRoomMessage(roomId, payload).catch(() => undefined);
    return payload;
  }

  private async roomMessageReferenceData(roomId: string, dto: SendBuddySessionMessageDto) {
    if (dto.referenceType !== 'message' || !dto.referenceId) return {};
    const referenced = await this.prisma.buddySessionMessage.findFirst({
      where: { id: dto.referenceId, roomId, deletedAt: null },
      select: { id: true },
    });
    if (!referenced) return {};
    return {
      referenceType: 'message',
      referenceId: dto.referenceId.trim(),
      referenceText: dto.referenceText?.trim() || undefined,
      referenceAuthorName: dto.referenceAuthorName?.trim() || undefined,
    };
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
    if (options.excludeParticipants) filters.push({ buddyRoomParticipants: { none: { roomId: room.id, kickedAt: null, leftAt: null } } });
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

  private inviteMessage(room: any) {
    const groupContext = room.scope === BuddySessionScope.group && room.group?.name ? ` in ${room.group.name}` : '';
    const lines = [
      `You're invited to join "${room.name}"${groupContext} on SweBudd.`,
      `Room: ${room.id}`,
      `Code: ${room.code}`,
    ];
    return lines.join('\n');
  }

  private canAccessPrivateRoom(userId: string, room: any) {
    return Boolean(room.participants?.some((participant: { userId: string; leftAt?: Date | string | null; kickedAt?: Date | string | null }) => (
      participant.userId === userId && !participant.leftAt && !participant.kickedAt
    )));
  }

  private isKickedFromRoom(userId: string, room: any) {
    return Boolean(room.participants?.some((participant: { userId: string; kickedAt?: Date | string | null }) => participant.userId === userId && participant.kickedAt));
  }

  private canRevealRoomCode(userId: string, room: any) {
    return this.canManageRoom(this.activeRoomParticipant(room, userId)?.role);
  }

  private isTrustedSessionGifUrl(value: string) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && /\.gif(\?.*)?$/i.test(parsed.href);
    } catch {
      return false;
    }
  }

  private activeRoomParticipant(room: any, userId: string) {
    return room.participants?.find((participant: { userId: string; role?: BuddyRoomParticipantRole | string; leftAt?: Date | string | null; kickedAt?: Date | string | null }) => (
      participant.userId === userId && !participant.leftAt && !participant.kickedAt
    ));
  }

  private isRoomOwnerRole(role?: BuddyRoomParticipantRole | string | null) {
    return role === BuddyRoomParticipantRole.owner || role === BuddyRoomParticipantRole.admin;
  }

  private canManageRoom(role?: BuddyRoomParticipantRole | string | null) {
    return this.isRoomOwnerRole(role);
  }

  private async touchRoomParticipantActivity(db: any, roomId: string, userId: string, at = new Date()) {
    const participant = await db.buddyRoomParticipant.update({
      where: { roomId_userId: { roomId, userId } },
      data: { lastActivityAt: at },
      select: { role: true },
    }).catch(() => null);
    if (participant && this.isRoomOwnerRole(participant.role)) {
      await db.buddyRoom.updateMany({ where: { id: roomId }, data: { expiresAt: this.roomExpiresAt(at) } });
    }
    return participant;
  }

  private roomExpiresAt(from = new Date()) {
    return new Date(from.getTime() + ROOM_OWNER_INACTIVITY_MS);
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
      user: this.toBuddyUser(session.user),
    };
  }

  private toBuddyUser(user: any) {
    const age = user?.dateOfBirth ? this.ageFromDate(user.dateOfBirth) : null;
    return {
      id: user?.id,
      displayName: user?.displayName ?? null,
      username: user?.username ?? null,
      profileImageUrl: user?.profileImageUrl ?? null,
      age,
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
      participants: room.participants
        ?.filter((participant: any) => !participant.leftAt && !participant.kickedAt)
        .map((participant: any) => this.toRoomParticipant(participant)) ?? [],
      activeSessions: room.sessions
        ?.filter((session: any) => session.expiresAt > new Date())
        .map((session: any) => this.toBuddy(session, session.latitude, session.longitude)) ?? [],
    };
  }

  private toRoomSummary(room: any, revealCode = false) {
    return {
      id: room.id,
      name: room.name,
      scope: room.scope,
      visibility: room.visibility,
      code: revealCode || room.visibility === BuddySessionVisibility.public ? room.code : undefined,
      groupId: room.groupId,
      group: room.group,
      creatorId: room.creatorId,
      activity: room.activity,
      subActivity: room.subActivity,
      expiresAt: room.expiresAt,
      createdAt: room.createdAt,
      participantCount: room._count?.sessions ?? 0,
    };
  }

  private toRoomParticipant(participant: any) {
    return {
      userId: participant.userId,
      role: participant.role,
      joinedAt: participant.joinedAt,
      lastActivityAt: participant.lastActivityAt,
      leftAt: participant.leftAt,
      kickedAt: participant.kickedAt,
      user: participant.user ? this.toBuddyUser(participant.user) : null,
    };
  }

  private toSessionMessage(message: any, readStates: any[] = []) {
    return {
      id: message.id,
      roomId: message.roomId,
      senderId: message.senderId,
      kind: message.kind,
      body: message.body,
      referenceType: message.referenceType,
      referenceId: message.referenceId,
      referenceText: message.referenceText,
      referenceAuthorName: message.referenceAuthorName,
      deletedAt: message.deletedAt,
      deletedById: message.deletedById,
      createdAt: message.createdAt,
      sender: message.sender,
      reactions: message.reactions ?? [],
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
    return { user: { select: this.buddyUserSelect() }, room: { include: this.roomInclude() } } as const;
  }

  private buddySessionInclude() {
    return { user: { select: this.buddyUserSelect() } } as const;
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
      sessions: {
        where: { expiresAt: { gt: now } },
        include: this.buddySessionInclude(),
        orderBy: { updatedAt: 'desc' },
      },
      participants: {
        where: { kickedAt: null, leftAt: null },
        orderBy: { joinedAt: 'asc' },
        select: {
          userId: true,
          role: true,
          joinedAt: true,
          lastActivityAt: true,
          leftAt: true,
          kickedAt: true,
          user: { select: this.buddyUserSelect() },
        },
      },
      _count: { select: { sessions: { where: { expiresAt: { gt: now } } } } },
    } as const;
  }

  private roomListInclude(now = new Date()) {
    return {
      group: { select: { id: true, name: true, slug: true } },
      participants: {
        where: { kickedAt: null, leftAt: null },
        select: { userId: true, role: true, leftAt: true, kickedAt: true },
      },
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

  private buddyUserSelect() {
    return { id: true, displayName: true, username: true, profileImageUrl: true, dateOfBirth: true } as const;
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
      reactions: true,
    } as const;
  }
}
