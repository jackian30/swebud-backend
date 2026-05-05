import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto, UpdateActivityDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('activities')
export class ActivitiesController {
  constructor(private activities: ActivitiesService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query('take', new ParseIntPipe({ optional: true })) take?: number) { return this.activities.list(user.id, take); }
  @Get('stats') stats(@CurrentUser() user: AuthUser, @Query('window') window?: 'week' | 'month' | 'year' | 'all') { return this.activities.stats(user.id, window); }
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateActivityDto) { return this.activities.create(user.id, dto); }
  @Patch(':id') update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateActivityDto) { return this.activities.update(user.id, id, dto); }
  @Delete(':id') remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.activities.remove(user.id, id); }
}
