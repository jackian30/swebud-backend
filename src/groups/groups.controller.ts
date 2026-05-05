import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { CreateGroupDto, GroupMessageDto, GroupPostDto } from './dto';
import { GroupsService } from './groups.service';

@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private groups: GroupsService) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) { return this.groups.create(user.id, dto); }
  @Get() list(@CurrentUser() user: AuthUser) { return this.groups.list(user.id); }
  @Get('invite/:code') joinByInvite(@CurrentUser() user: AuthUser, @Param('code') code: string) { return this.groups.joinByInvite(user.id, code); }
  @Get(':slug') get(@CurrentUser() user: AuthUser, @Param('slug') slug: string) { return this.groups.get(user.id, slug); }
  @Post(':id/join') join(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.groups.join(user.id, id); }
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
  @Get(':id/messages') messages(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.groups.messages(user.id, id); }
  @Post(':id/messages') sendMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: GroupMessageDto) { return this.groups.sendMessage(user.id, id, dto); }
}
