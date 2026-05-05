import { Injectable } from '@nestjs/common';
import { BuddyActivity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NearbyBuddyQueryDto, UpsertBuddySessionDto } from './dto';

const DEFAULT_TTL_MINUTES = 60;
const DEFAULT_RADIUS_KM = 25;
const DEFAULT_TAKE = 50;

@Injectable()
export class BuddyService {
  constructor(private prisma: PrismaService) {}

  async me(userId: string) {
    const now = new Date();
    const session = await this.prisma.buddySession.findUnique({ where: { userId }, include: { user: { select: this.userSelect() } } });
    if (!session || session.expiresAt <= now) return null;
    return this.toBuddy(session, session.latitude, session.longitude);
  }

  async upsert(userId: string, dto: UpsertBuddySessionDto) {
    const ttlMinutes = Math.min(Math.max(dto.ttlMinutes ?? DEFAULT_TTL_MINUTES, 5), 120);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const subActivity = dto.subActivity?.trim() || null;
    const session = await this.prisma.buddySession.upsert({
      where: { userId },
      create: { userId, activity: dto.activity ?? null, subActivity, latitude: dto.latitude, longitude: dto.longitude, expiresAt },
      update: { activity: dto.activity ?? null, subActivity, latitude: dto.latitude, longitude: dto.longitude, expiresAt },
      include: { user: { select: this.userSelect() } },
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
    const sessions = await this.prisma.buddySession.findMany({
      where: {
        userId: { not: userId, notIn: blocked },
        ...(query.activity ? { activity: query.activity } : {}),
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: this.userSelect() } },
      orderBy: { updatedAt: 'desc' },
      take: 250,
    });
    return sessions
      .map((session) => this.toBuddy(session, query.lat, query.lng))
      .filter((session) => session.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, take);
  }

  activityOptions() {
    return Object.values(BuddyActivity);
  }

  private async blockedUserIds(userId: string) {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    return rows.map((row) => row.blockerId === userId ? row.blockedId : row.blockerId);
  }

  private toBuddy(session: any, lat: number, lng: number) {
    const age = session.user.dateOfBirth ? this.ageFromDate(session.user.dateOfBirth) : null;
    return {
      id: session.id,
      userId: session.userId,
      activity: session.activity,
      subActivity: session.subActivity,
      latitude: session.latitude,
      longitude: session.longitude,
      expiresAt: session.expiresAt,
      updatedAt: session.updatedAt,
      distanceKm: this.distanceKm(lat, lng, session.latitude, session.longitude),
      user: { ...session.user, dateOfBirth: undefined, age },
    };
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
    return { id: true, displayName: true, username: true, profileImageUrl: true, gender: true, dateOfBirth: true, activityPersona: true } as const;
  }
}
