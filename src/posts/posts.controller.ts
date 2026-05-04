import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { CommentDto, CreatePostDto, ReportPostDto, RepostDto, UpdateCommentDto, UpdatePostDto } from './dto';
import { PostsService } from './posts.service';

@UseGuards(JwtAuthGuard)
@Controller('posts')
export class PostsController {
  constructor(private posts: PostsService) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto) { return this.posts.create(user.id, dto); }
  @Get() list(@Query('take', new ParseIntPipe({ optional: true })) take?: number, @Query('cursor') cursor?: string) { return this.posts.list(take, cursor); }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.get(id, user.id); }
  @Patch(':id') update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePostDto) { return this.posts.update(user.id, id, dto); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.remove(user.id, id); }
  @Post(':id/save') save(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.save(user.id, id); }
  @Delete(':id/save') unsave(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.unsave(user.id, id); }
  @Post(':id/repost') repost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RepostDto) { return this.posts.repost(user.id, id, dto); }
  @Post(':id/hide') hide(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.hide(user.id, id); }
  @Post(':id/pin') pin(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.pin(user.id, id); }
  @Delete(':id/pin') unpin(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.unpin(user.id, id); }
  @Post(':id/report') report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReportPostDto) { return this.posts.report(user.id, id, dto); }
  @Post(':id/like') like(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.like(user.id, id); }
  @Delete(':id/like') unlike(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.posts.unlike(user.id, id); }
  @Get(':id/comments') comments(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('sort') sort?: 'top' | 'newest' | 'oldest') { return this.posts.comments(id, sort, user.id); }
  @Post(':id/comments') comment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CommentDto) { return this.posts.comment(user.id, id, dto); }
  @Patch(':postId/comments/:commentId') updateComment(@CurrentUser() user: AuthUser, @Param('postId') postId: string, @Param('commentId') commentId: string, @Body() dto: UpdateCommentDto) { return this.posts.updateComment(user.id, postId, commentId, dto); }
  @Post(':postId/comments/:commentId/like') likeComment(@CurrentUser() user: AuthUser, @Param('postId') postId: string, @Param('commentId') commentId: string) { return this.posts.likeComment(user.id, postId, commentId); }
  @Delete(':postId/comments/:commentId/like') unlikeComment(@CurrentUser() user: AuthUser, @Param('postId') postId: string, @Param('commentId') commentId: string) { return this.posts.unlikeComment(user.id, postId, commentId); }
  @Delete(':postId/comments/:commentId') @HttpCode(204) removeComment(@CurrentUser() user: AuthUser, @Param('postId') postId: string, @Param('commentId') commentId: string) { return this.posts.removeComment(user.id, postId, commentId); }
}
