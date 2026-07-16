import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { KlipySearchQueryDto } from './dto';
import { KlipyService } from './klipy.service';

@UseGuards(JwtAuthGuard)
@Controller('klipy')
export class KlipyController {
  constructor(private klipy: KlipyService) {}

  @Get('search')
  search(@Query() query: KlipySearchQueryDto) {
    return this.klipy.search(query.q ?? '', query.type ?? 'gifs', query.limit ?? 24);
  }
}
