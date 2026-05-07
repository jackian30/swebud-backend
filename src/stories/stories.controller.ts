import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ChatGateway } from '../chat/chat.gateway';
import { CreateStoryDto, ReactStoryDto, ReplyStoryDto } from './dto';
import { StoriesService } from './stories.service';

@UseGuards(JwtAuthGuard)
@Controller(['actsnaps', 'stories'])
export class StoriesController {
  constructor(private stories: StoriesService, private gateway: ChatGateway) {}

  @Get() list(@CurrentUser() user: AuthUser) { return this.stories.list(user.id); }
  @Get('active-authors') activeAuthors(@CurrentUser() user: AuthUser, @Query('userIds') userIds?: string | string[]) {
    const ids = (Array.isArray(userIds) ? userIds : [userIds ?? ''])
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    return this.stories.activeAuthors(user.id, ids);
  }
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateStoryDto) { return this.stories.create(user.id, dto); }
  @Get(':id/views') viewers(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.stories.viewers(user.id, id); }
  @Post(':id/view') view(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.stories.view(user.id, id); }
  @Post(':id/reactions') react(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReactStoryDto) { return this.stories.react(user.id, id, dto); }
  @Post(':id/replies') async reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyStoryDto) {
    const result = await this.stories.reply(user.id, id, dto);
    const event = 'status' in result ? 'chat:request' : 'chat:message';
    if (result.recipientId) this.gateway.emitMessage(result.recipientId, event, result);
    if (!('status' in result)) this.gateway.emitMessage(user.id, event, result);
    return result;
  }
  @Delete(':id/reactions') removeReaction(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.stories.removeReaction(user.id, id); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.stories.remove(user.id, id); }
}
