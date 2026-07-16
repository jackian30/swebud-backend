import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { UuidParam } from '../common/uuid-param.decorator';
import { AcceptGroupInviteCodeDto, CreateGroupChannelDto, CreateGroupDto, GroupChatMuteDto, GroupChatPinDto, GroupInviteCandidatesQueryDto, GroupListQueryDto, GroupMessageDto, GroupMineQueryDto, GroupPostDto, GroupPostsQueryDto, GroupSummaryQueryDto, InviteGroupUsersDto, ReportGroupDto, UpdateGroupRoleDto, UpdateGroupSettingsDto } from './dto';
import { GroupsService } from './groups.service';
import { ChatGateway } from '../chat/chat.gateway';

@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private groups: GroupsService, private chatGateway: ChatGateway) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) { return this.groups.create(user.id, dto); }
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: GroupListQueryDto) {
    return this.groups.list(user.id, {
      take: query.take,
      cursor: query.cursor,
      discoverOnly: query.discover ?? false,
    });
  }
  @Get('mine') mine(@CurrentUser() user: AuthUser, @Query() query: GroupMineQueryDto) {
    return this.groups.mine(user.id, query);
  }
  @Post('invite/accept') joinByInvite(@CurrentUser() user: AuthUser, @Body() dto: AcceptGroupInviteCodeDto) { return this.groups.joinByInvite(user.id, dto.code); }
  @Get('invites') invites(@CurrentUser() user: AuthUser) { return this.groups.invitations(user.id); }
  @Post('invites/:inviteId/accept') acceptInvite(@CurrentUser() user: AuthUser, @UuidParam('inviteId') inviteId: string) { return this.groups.acceptInvite(user.id, inviteId); }
  @Post('invites/:inviteId/decline') declineInvite(@CurrentUser() user: AuthUser, @UuidParam('inviteId') inviteId: string) { return this.groups.declineInvite(user.id, inviteId); }
  @Get(':slug') get(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Query() query: GroupSummaryQueryDto) {
    return this.groups.get(user.id, slug, { summaryOnly: query.summary ?? false });
  }
  @Post(':id/join') join(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.groups.join(user.id, id); }
  @Get(':id/invite-candidates') inviteCandidates(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Query() query: GroupInviteCandidatesQueryDto) { return this.groups.inviteCandidates(user.id, id, query.q); }
  @Post(':id/invites') inviteUsers(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: InviteGroupUsersDto) { return this.groups.inviteUsers(user.id, id, dto); }
  @Patch(':id/settings') updateSettings(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: UpdateGroupSettingsDto) { return this.groups.updateSettings(user.id, id, dto); }
  @Post(':id/report') report(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: ReportGroupDto) { return this.groups.report(user.id, id, dto); }
  @Patch(':id/members/:memberId/role') updateRole(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @UuidParam('memberId') memberId: string, @Body() dto: UpdateGroupRoleDto) { return this.groups.updateRole(user.id, id, memberId, dto.role); }
  @Get(':id/posts') posts(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Query() query: GroupPostsQueryDto,
  ) {
    return this.groups.posts(user.id, id, {
      ...query,
      mine: query.mine ?? false,
    });
  }
  @Post(':id/posts') createPost(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: GroupPostDto) { return this.groups.createPost(user.id, id, dto); }
  @Delete(':id/posts/:postId') @HttpCode(204) removePost(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @UuidParam('postId') postId: string) { return this.groups.removePost(user.id, id, postId); }
  @Get(':id/channels') channels(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.groups.channels(user.id, id); }
  @Patch(':id/mute') muteGroupChat(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: GroupChatMuteDto) { return this.groups.setGroupMute(user.id, id, dto); }
  @Patch(':id/pin') pinGroupChat(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: GroupChatPinDto) { return this.groups.setGroupPin(user.id, id, dto.pinned); }
  @Post(':id/channels') createChannel(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: CreateGroupChannelDto) { return this.groups.createChannel(user.id, id, dto); }
  @Patch(':id/channels/:channelId/mute') muteChannel(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @UuidParam('channelId') channelId: string, @Body() dto: GroupChatMuteDto) { return this.groups.setChannelMute(user.id, id, channelId, dto); }
  @Patch(':id/channels/:channelId/pin') pinChannel(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @UuidParam('channelId') channelId: string, @Body() dto: GroupChatPinDto) { return this.groups.setChannelPin(user.id, id, channelId, dto.pinned); }
  @Get(':id/channels/:channelId/messages') channelMessages(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @UuidParam('channelId') channelId: string) { return this.groups.messages(user.id, id, channelId); }
  @Patch(':id/channels/:channelId/read') async markChannelRead(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @UuidParam('channelId') channelId: string) {
    const result = await this.groups.markChannelRead(user.id, id, channelId);
    const recipients = await this.groups.messageRecipients(id, channelId);
    for (const recipientId of recipients) this.chatGateway.emitMessage(recipientId, 'chat:group-read', result);
    return result;
  }
  @Post(':id/channels/:channelId/messages') async sendChannelMessage(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @UuidParam('channelId') channelId: string, @Body() dto: GroupMessageDto) {
    const message = await this.groups.sendMessage(user.id, id, channelId, dto);
    const recipients = await this.groups.messageRecipients(id, message.channelId ?? channelId);
    for (const recipientId of recipients) this.chatGateway.emitMessage(recipientId, 'chat:group-message', message);
    return message;
  }
  @Get(':id/messages') messages(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.groups.messages(user.id, id); }
  @Post(':id/messages') async sendMessage(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: GroupMessageDto) {
    const message = await this.groups.sendMessage(user.id, id, undefined, dto);
    const recipients = await this.groups.messageRecipients(id, message.channelId ?? '');
    for (const recipientId of recipients) this.chatGateway.emitMessage(recipientId, 'chat:group-message', message);
    return message;
  }

}
