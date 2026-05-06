import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { BuddyService } from './buddy.service';
import { BuddyRoomQueryDto, CreateBuddyRoomDto, JoinBuddyRoomDto, NearbyBuddyQueryDto, UpsertBuddySessionDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('buddy')
export class BuddyController {
  constructor(private buddy: BuddyService) {}

  @Get('activities') activities() { return this.buddy.activityOptions(); }
  @Get('session/me') me(@CurrentUser() user: AuthUser) { return this.buddy.me(user.id); }
  @Put('session') upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertBuddySessionDto) { return this.buddy.upsert(user.id, dto); }
  @Delete('session') stop(@CurrentUser() user: AuthUser) { return this.buddy.stop(user.id); }
  @Get('nearby') nearby(@CurrentUser() user: AuthUser, @Query() query: NearbyBuddyQueryDto) { return this.buddy.nearby(user.id, query); }

  @Get('rooms') rooms(@CurrentUser() user: AuthUser, @Query() query: BuddyRoomQueryDto) { return this.buddy.rooms(user.id, query); }
  @Post('rooms') createRoom(@CurrentUser() user: AuthUser, @Body() dto: CreateBuddyRoomDto) { return this.buddy.createRoom(user.id, dto); }
  @Post('rooms/join') joinRoom(@CurrentUser() user: AuthUser, @Body() dto: JoinBuddyRoomDto) { return this.buddy.joinRoom(user.id, dto); }
  @Delete('rooms/:id') closeRoom(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.buddy.closeRoom(user.id, id); }
}
