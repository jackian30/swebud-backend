import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(['', 'live'])
  live() {
    return {
      ok: true,
      version: process.env.APP_VERSION || '0.2.0-beta',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      database: 'ok',
      version: process.env.APP_VERSION || '0.2.0-beta',
      timestamp: new Date().toISOString(),
    };
  }
}
