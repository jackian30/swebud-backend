import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { appVersion } from './common/app-version';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(['', 'live'])
  live() {
    return {
      ok: true,
      version: appVersion(),
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
      version: appVersion(),
      timestamp: new Date().toISOString(),
    };
  }
}
