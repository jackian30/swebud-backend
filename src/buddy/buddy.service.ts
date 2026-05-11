import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BuddyActivity, BuddySessionScope, BuddySessionVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BuddyRoomQueryDto, CreateBuddyRoomDto, JoinBuddyRoomDto, NearbyBuddyQueryDto, UpsertBuddySessionDto } from './dto';
import { activityPersonaLinkSelect, exposeActivityPersonas } from '../common/activity-personas';

const DEFAULT_TTL_MINUTES = 60;
const DEFAULT_ROOM_TTL_MINUTES = 120;
const DEFAULT_RADIUS_KM = 25;
const DEFAULT_TAKE = 50;

@Injectable()
export class BuddyService {
  constructor(private prisma: PrismaService) {}

  async me(userId: string) {
    const now = new Date();
    const session = await this.prisma.buddySession.findUnique({ where: { userId }, include: this.sessionInclude() });
    if (!session || session.expiresAt <= now) return null;
    return this.toBuddy(session, session.latitude, session.longitude);
  }

  async upsert(userId: string, dto: UpsertBuddySessionDto) {
    const room = dto.roomId ? await this.ensureCanJoinRoom(userId, { roomId: dto.roomId }) : null;
    const ttlMinutes = Math.min(Math.max(dto.ttlMinutes ?? DEFAULT_TTL_MINUTES, 5), 120);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const activity = room?.activity ?? dto.activity ?? null;
    const subActivity = (room?.subActivity ?? dto.subActivity)?.trim() || null;
    const session = await this.prisma.buddySession.upsert({
      where: { userId },
      create: { userId, roomId: room?.id ?? null, activity, subActivity, latitude: dto.latitude, longitude: dto.longitude, expiresAt },
      update: { roomId: room?.id ?? null, activity, subActivity, latitude: dto.latitude, longitude: dto.longitude, expiresAt },
      include: this.sessionInclude(),
    });
    return this.toBuddy(session, dto.latitude, dto.longitude);
  }

  async stop(userId: string) {
    await this.prisma.buddySession.delete({ where: { userId } }).catch(() => null);
    return { ok: true };
  }

  async nearby(userId: string, query: NearbyBuddyQueryDto) {
    const radiusKm = query.radiusKm ?? DEFAULT_RADIUS_KM;
    const take = query.take ?? DEFAULT_TAKE;
    const blocked = await this.blockedUserIds(userId);
    const room = query.roomId ? await this.ensureCanJoinRoom(userId, { roomId: query.roomId }) : null;
    const sessions = await this.prisma.buddySession.findMany({
      where: {
        userId: { not: userId, notIn: blocked },
        roomId: room ? room.id : null,
        ...(query.activity && !room ? { activity: query.activity } : {}),
        expiresAt: { gt: new Date() },
      },
      include: this.sessionInclude(),
      orderBy: { updatedAt: 'desc' },
      take: 250,
    });
    return sessions
      .map((session) => this.toBuddy(session, query.lat, query.lng))
      .filter((session) => session.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, take);
  }

  async rooms(userId: string, query: BuddyRoomQueryDto = {}) {
    const now = new Date();
    const where: any = { expiresAt: { gt: now } };
    if (query.groupId) {
      await this.ensureGroupMember(userId, query.groupId);
      where.scope = 'group';
      where.groupId = query.groupId;
    } else if (query.scope === 'group') {
      const memberships = await this.prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } });
      where.scope = 'group';
      where.groupId = { in: memberships.map((member) => member.groupId) };
    } else {
      where.scope = 'public';
      where.visibility = 'public';
    }
    const rooms = await this.prisma.buddyRoom.findMany({ where, orderBy: { createdAt: 'desc' }, include: this.roomInclude() });
    return rooms.map((room) => this.toRoom(room));
  }

  async createRoom(userId: string, dto: CreateBuddyRoomDto) {
    const scope = dto.groupId ? BuddySessionScope.group : (dto.scope ?? BuddySessionScope.public);
    if (scope === BuddySessionScope.group) {
      if (!dto.groupId) throw new BadRequestException('Group buddy sessions need a group.');
      await this.ensureGroupMember(userId, dto.groupId);
    }
    const ttlMinutes = Math.min(Math.max(dto.ttlMinutes ?? DEFAULT_ROOM_TTL_MINUTES, 15), 360);
    const room = await this.prisma.buddyRoom.create({
      data: {
        name: dto.name.trim(),
        scope,
        visibility: dto.visibility ?? BuddySessionVisibility.public,
        code: await this.uniqueRoomCode(),
        groupId: scope === BuddySessionScope.group ? dto.groupId : null,
        creatorId: userId,
        activity: dto.activity ?? null,
        subActivity: dto.subActivity?.trim() || null,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
      include: this.roomInclude(),
    });
    return this.toRoom(room, true);
  }

  async joinRoom(userId: string, dto: JoinBuddyRoomDto) {
    const room = await this.ensureCanJoinRoom(userId, dto);
    return this.upsert(userId, { roomId: room.id, latitude: dto.latitude, longitude: dto.longitude, ttlMinutes: DEFAULT_TTL_MINUTES });
  }

  async closeRoom(userId: string, roomId: string) {
    const room = await this.prisma.buddyRoom.findUnique({ where: { id: roomId }, select: { creatorId: true } });
    if (!room) throw new NotFoundException('Buddy session not found');
    if (room.creatorId !== userId) throw new ForbiddenException('Only the creator can close this buddy session.');
    await this.prisma.buddyRoom.delete({ where: { id: roomId } });
    return { ok: true };
  }

  activityOptions() {
    return Object.values(BuddyActivity);
  }

  private async ensureCanJoinRoom(userId: string, dto: { roomId?: string; code?: string }) {
    if (!dto.roomId && !dto.code) throw new BadRequestException('Room ID or code is required.');
    const room = await this.prisma.buddyRoom.findFirst({
      where: dto.roomId ? { id: dto.roomId } : { code: dto.code?.trim().toUpperCase() },
      include: this.roomInclude(),
    });
    if (!room || room.expiresAt <= new Date()) throw new NotFoundException('Buddy session not found');
    if (room.scope === BuddySessionScope.group) await this.ensureGroupMember(userId, room.groupId!);
    if (room.visibility === BuddySessionVisibility.private && room.creatorId !== userId && dto.code?.trim().toUpperCase() !== room.code) {
      throw new ForbiddenException('Enter the buddy session code to join.');
    }
    return room;
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
      room: session.room ? this.toRoom(session.room, session.room.creatorId === session.userId) : null,
      activity: session.activity,
      subActivity: session.subActivity,
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

  private sessionInclude() {
    return { user: { select: this.userSelect() }, room: { include: this.roomInclude() } } as const;
  }

  private roomInclude() {
    return {
      group: { select: { id: true, name: true, slug: true } },
      creator: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      _count: { select: { sessions: true } },
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
}
