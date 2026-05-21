import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateThemeDto } from './dto';

@Injectable()
export class ThemeService {
  constructor(private prisma: PrismaService) {}

  get(userId: string) {
    return this.prisma.userTheme.upsert({ where: { userId }, create: { userId, theme: 'system', mapVisual: 'streets' }, update: {} });
  }

  update(userId: string, dto: UpdateThemeDto) {
    return this.prisma.userTheme.upsert({
      where: { userId },
      create: {
        userId,
        theme: dto.theme ?? 'system',
        mapVisual: dto.mapVisual ?? 'streets',
      },
      update: {
        ...(dto.theme ? { theme: dto.theme } : {}),
        ...(dto.mapVisual ? { mapVisual: dto.mapVisual } : {}),
      },
    });
  }
}
