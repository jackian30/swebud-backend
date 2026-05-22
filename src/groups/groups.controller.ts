import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { CreateGroupChannelDto, CreateGroupDto, GroupMessageDto, GroupPostDto, ReportGroupDto, UpdateGroupRoleDto, UpdateGroupSettingsDto } from './dto';
import { GroupsService } from './groups.service';
import { ChatGateway } from '../chat/chat.gateway';

@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private groups: GroupsService, private chatGateway: ChatGateway) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) { return this.groups.create(user.id, dto); }
  @Get() list(@CurrentUser() user: AuthUser) { return this.groups.list(user.id); }
  @Get('mine') mine(@CurrentUser() user: AuthUser) { return this.groups.mine(user.id); }
  @Get('invite/:code') joinByInvite(@CurrentUser() user: AuthUser, @Param('code') code: string) { return this.groups.joinByInvite(user.id, code); }
  @Get(':slug') get(@CurrentUser() user: AuthUser, @Param('slug') slug: string) { return this.groups.get(user.id, slug); }
  @Post(':id/join') join(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.groups.join(user.id, id); }
  @Patch(':id/settings') updateSettings(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateGroupSettingsDto) { return this.groups.updateSettings(user.id, id, dto); }
  @Post(':id/report') report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReportGroupDto) { return this.groups.report(user.id, id, dto); }
  @Patch(':id/members/:memberId/role') updateRole(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('memberId') memberId: string, @Body() dto: UpdateGroupRoleDto) { return this.groups.updateRole(user.id, id, memberId, dto.role); }
  @Get(':id/posts') posts(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('sort') sort?: 'latest' | 'trending' | 'most-commented' | 'oldest',
    @Query('hashtag') hashtag?: string,
    @Query('q') q?: string,
    @Query('mine') mine?: string,
    @Query('take') take?: string,
    @Query('cursor') cursor?: string,
    @Query('timezone') timezone?: string,
  ) {
    const parsedTake = take ? Number.parseInt(take, 10) : undefined;
    const parsedCursor = cursor ? Number.parseInt(cursor, 10) : undefined;
    return this.groups.posts(user.id, id, {
      sort,
      hashtag,
      q,
      mine: mine === 'true',
      take: Number.isFinite(parsedTake) ? parsedTake : undefined,
      cursor: Number.isFinite(parsedCursor) ? parsedCursor : undefined,
      timezone,
    });
  }
  @Post(':id/posts') createPost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: GroupPostDto) { return this.groups.createPost(user.id, id, dto); }
  @Delete(':id/posts/:postId') @HttpCode(204) removePost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('postId') postId: string) { return this.groups.removePost(user.id, id, postId); }
  @Get(':id/channels') channels(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.groups.channels(user.id, id); }
  @Post(':id/channels') createChannel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateGroupChannelDto) { return this.groups.createChannel(user.id, id, dto); }
  @Get(':id/channels/:channelId/messages') channelMessages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('channelId') channelId: string) { return this.groups.messages(user.id, id, channelId); }
  @Post(':id/channels/:channelId/messages') async sendChannelMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('channelId') channelId: string, @Body() dto: GroupMessageDto) {
    const message = await this.groups.sendMessage(user.id, id, channelId, dto);
    const recipients = await this.groups.messageRecipients(id, message.channelId ?? channelId);
    for (const recipientId of recipients) this.chatGateway.emitMessage(recipientId, 'chat:group-message', message);
    return message;
  }
  @Get(':id/messages') messages(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.groups.messages(user.id, id); }
  @Post(':id/messages') async sendMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: GroupMessageDto) {
    const message = await this.groups.sendMessage(user.id, id, undefined, dto);
    const recipients = await this.groups.messageRecipients(id, message.channelId ?? '');
    for (const recipientId of recipients) this.chatGateway.emitMessage(recipientId, 'chat:group-message', message);
    return message;
  }
}
