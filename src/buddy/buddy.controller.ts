import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { BuddyService } from './buddy.service';
import { BuddyRoomQueryDto, BuddySessionMessageReactionDto, CreateBuddyRoomDto, DiscoverableBuddyQueryDto, InviteBuddyRoomDto, JoinBuddyRoomDto, KickBuddyRoomParticipantDto, NearbyBuddyQueryDto, SendBuddySessionMessageDto, UpdateBuddyRoomParticipantRoleDto, UpsertBuddySessionDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('buddy')
export class BuddyController {
  constructor(private buddy: BuddyService) {}

  @Get('activities') activities() { return this.buddy.activityOptions(); }
  @Get('session/me') me(@CurrentUser() user: AuthUser) { return this.buddy.me(user.id); }
  @Put('session') upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertBuddySessionDto) { return this.buddy.upsert(user.id, dto); }
  @Delete('session/presence') stopPresence(@CurrentUser() user: AuthUser) { return this.buddy.stopPresence(user.id); }
  @Delete('session') stop(@CurrentUser() user: AuthUser) { return this.buddy.stop(user.id); }
  @Get('nearby') nearby(@CurrentUser() user: AuthUser, @Query() query: NearbyBuddyQueryDto) { return this.buddy.nearby(user.id, query); }
  @Get('discoverable') discoverable(@CurrentUser() user: AuthUser, @Query() query: DiscoverableBuddyQueryDto) { return this.buddy.discoverable(user.id, query); }

  @Get('rooms') rooms(@CurrentUser() user: AuthUser, @Query() query: BuddyRoomQueryDto) { return this.buddy.rooms(user.id, query); }
  @Get('rooms/:id') room(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.buddy.room(user.id, id); }
  @Post('rooms') createRoom(@CurrentUser() user: AuthUser, @Body() dto: CreateBuddyRoomDto) { return this.buddy.createRoom(user.id, dto); }
  @Post('rooms/join') joinRoom(@CurrentUser() user: AuthUser, @Body() dto: JoinBuddyRoomDto) { return this.buddy.joinRoom(user.id, dto); }
  @Get('rooms/:id/invite-candidates') inviteCandidates(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('q') q?: string) {
    return this.buddy.inviteCandidates(user.id, id, q);
  }
  @Post('rooms/:id/invites') async inviteRoom(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InviteBuddyRoomDto) {
    const result = await this.buddy.inviteRoom(user.id, id, dto);
    return { sent: result.sent, recipients: result.recipients };
  }
  @Get('rooms/:id/messages') roomMessages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buddy.roomMessages(user.id, id);
  }
  @Post('rooms/:id/messages') sendRoomMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendBuddySessionMessageDto) {
    return this.buddy.sendRoomMessage(user.id, id, dto);
  }
  @Post('rooms/:id/messages/:messageId/reactions') reactToRoomMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Body() dto: BuddySessionMessageReactionDto) {
    return this.buddy.reactToRoomMessage(user.id, id, messageId, dto);
  }
  @Delete('rooms/:id/messages/:messageId/reactions') unreactToRoomMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Query('emoji') emoji: string) {
    return this.buddy.unreactToRoomMessage(user.id, id, messageId, emoji);
  }
  @Post('rooms/:id/messages/:messageId/unsend') unsendRoomMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string) {
    return this.buddy.unsendRoomMessage(user.id, id, messageId);
  }
  @Delete('rooms/:id/messages/:messageId') deleteRoomMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string) {
    return this.buddy.deleteRoomMessage(user.id, id, messageId);
  }
  @Post('rooms/:id/messages/read') markRoomMessagesRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buddy.markRoomMessagesRead(user.id, id);
  }
  @Delete('rooms/:id/participants/:userId') kickRoomParticipant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: KickBuddyRoomParticipantDto,
  ) {
    return this.buddy.kickRoomParticipant(user.id, id, targetUserId, dto);
  }
  @Patch('rooms/:id/participants/:userId/role') updateRoomParticipantRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateBuddyRoomParticipantRoleDto,
  ) {
    return this.buddy.updateRoomParticipantRole(user.id, id, targetUserId, dto);
  }
  @Delete('rooms/:id') closeRoom(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.buddy.closeRoom(user.id, id); }
}
