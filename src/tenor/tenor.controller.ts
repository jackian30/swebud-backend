import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TenorService } from './tenor.service';

@UseGuards(JwtAuthGuard)
@Controller('tenor')
export class TenorController {
  constructor(private tenor: TenorService) {}

  @Get('search')
  search(@Query('q') q = '', @Query('type') type: 'gifs' | 'stickers' = 'gifs', @Query('limit') limit?: string) {
    return this.tenor.search(q, type === 'stickers' ? 'stickers' : 'gifs', Number.parseInt(limit ?? '24', 10));
  }
}
