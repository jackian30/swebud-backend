import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateActivityDto, UpdateActivityDto } from './dto';

type StatsWindow = 'week' | 'month' | 'year' | 'all';

@Injectable()
export class ActivitiesService {
  constructor(private prisma: PrismaService) {}

  list(userId: string, take = 50) {
    return this.prisma.activity.findMany({ where: { userId }, take: Math.min(take, 100), orderBy: { startedAt: 'desc' }, include: { integration: { select: { provider: true, status: true } }, posts: { select: { id: true, visibility: true } } } });
  }

  create(userId: string, dto: CreateActivityDto) {
    const data = this.toUncheckedActivityCreateData({ ...dto, userId, source: dto.source ?? 'manual' });
    return this.prisma.activity.create({ data });
  }

  async update(userId: string, id: string, dto: UpdateActivityDto) {
    await this.ensureOwner(userId, id);
    return this.prisma.activity.update({ where: { id }, data: this.toUncheckedActivityUpdateData(dto) });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwner(userId, id);
    await this.prisma.activity.delete({ where: { id } });
    return { ok: true };
  }

  async stats(userId: string, window: StatsWindow = 'month') {
    const since = this.since(window);
    const where = { userId, ...(since ? { startedAt: { gte: since } } : {}) };
    const [aggregate, byType, recent] = await Promise.all([
      this.prisma.activity.aggregate({ where, _count: { id: true }, _sum: { durationSeconds: true, distanceMeters: true, elevationGainMeters: true, calories: true } }),
      this.prisma.activity.groupBy({ by: ['type'], where, _count: { id: true }, _sum: { durationSeconds: true, distanceMeters: true, calories: true }, orderBy: { _count: { id: 'desc' } } }),
      this.prisma.activity.findMany({ where, take: 5, orderBy: { startedAt: 'desc' }, select: { id: true, type: true, title: true, startedAt: true, distanceMeters: true, durationSeconds: true, calories: true } }),
    ]);
    return { window, totals: { count: aggregate._count.id, durationSeconds: aggregate._sum.durationSeconds ?? 0, distanceMeters: aggregate._sum.distanceMeters ?? 0, elevationGainMeters: aggregate._sum.elevationGainMeters ?? 0, calories: aggregate._sum.calories ?? 0 }, byType, recent };
  }

  private async ensureOwner(userId: string, id: string) {
    const activity = await this.prisma.activity.findUniqueOrThrow({ where: { id }, select: { userId: true } });
    if (activity.userId !== userId) throw new ForbiddenException('Only the owner can manage this activity');
  }

  private toUncheckedActivityCreateData(dto: CreateActivityDto & { userId: string }): Prisma.ActivityUncheckedCreateInput {
    return { ...dto, raw: dto.raw as Prisma.InputJsonValue | undefined };
  }

  private toUncheckedActivityUpdateData(dto: UpdateActivityDto): Prisma.ActivityUncheckedUpdateInput {
    return { ...dto, raw: dto.raw as Prisma.InputJsonValue | undefined };
  }

  private since(window: StatsWindow) {
    const date = new Date();
    if (window === 'week') date.setDate(date.getDate() - 7);
    else if (window === 'month') date.setMonth(date.getMonth() - 1);
    else if (window === 'year') date.setFullYear(date.getFullYear() - 1);
    else return undefined;
    return date;
  }
}
