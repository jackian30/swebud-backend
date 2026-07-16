import { Body, Controller, Delete, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { UuidParam } from '../common/uuid-param.decorator';
import { ActivitiesService } from './activities.service';
import { ActivityListQueryDto, ActivityStatsQueryDto, CreateActivityDto, UpdateActivityDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('activities')
export class ActivitiesController {
  constructor(private activities: ActivitiesService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: ActivityListQueryDto) { return this.activities.list(user.id, query.take); }
  @Get('stats') stats(@CurrentUser() user: AuthUser, @Query() query: ActivityStatsQueryDto) { return this.activities.stats(user.id, query.window); }
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateActivityDto) { return this.activities.create(user.id, dto); }
  @Patch(':id') update(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: UpdateActivityDto) { return this.activities.update(user.id, id, dto); }
  @Delete(':id') remove(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.activities.remove(user.id, id); }
}
