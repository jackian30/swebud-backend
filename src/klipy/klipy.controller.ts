import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { KlipyService } from './klipy.service';

@UseGuards(JwtAuthGuard)
@Controller('klipy')
export class KlipyController {
  constructor(private klipy: KlipyService) {}

  @Get('search')
  search(@Query('q') q = '', @Query('type') type: 'gifs' | 'stickers' = 'gifs', @Query('limit') limit?: string) {
    return this.klipy.search(q, type === 'stickers' ? 'stickers' : 'gifs', Number.parseInt(limit ?? '24', 10));
  }
}
