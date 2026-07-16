import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { UuidParam } from '../common/uuid-param.decorator';
import { CommentDto, CommentListQueryDto, CreatePostDto, PostListQueryDto, ReplyListQueryDto, ReportPostDto, RepostDto, UpdateCommentDto, UpdatePostDto } from './dto';
import { PostsService } from './posts.service';

@UseGuards(JwtAuthGuard)
@Controller('posts')
export class PostsController {
  constructor(private posts: PostsService) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto) { return this.posts.create(user.id, dto); }
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: PostListQueryDto) { return this.posts.list(user.id, query.take, query.cursor); }
  @Get(':id') get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.get(id, user.id); }
  @Patch(':id') update(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: UpdatePostDto) { return this.posts.update(user.id, id, dto); }
  @Get(':id/history') postHistory(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.postHistory(user.id, id); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.remove(user.id, id); }
  @Post(':id/save') save(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.save(user.id, id); }
  @Delete(':id/save') unsave(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.unsave(user.id, id); }
  @Post(':id/repost') repost(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: RepostDto) { return this.posts.repost(user.id, id, dto); }
  @Post('reposts/:repostId/like') likeRepost(@CurrentUser() user: AuthUser, @UuidParam('repostId') repostId: string) { return this.posts.likeRepost(user.id, repostId); }
  @Delete('reposts/:repostId/like') unlikeRepost(@CurrentUser() user: AuthUser, @UuidParam('repostId') repostId: string) { return this.posts.unlikeRepost(user.id, repostId); }
  @Post(':id/hide') hide(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.hide(user.id, id); }
  @Post(':id/pin') pin(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.pin(user.id, id); }
  @Delete(':id/pin') unpin(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.unpin(user.id, id); }
  @Post(':id/report') report(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: ReportPostDto) { return this.posts.report(user.id, id, dto); }
  @Post(':id/like') like(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.like(user.id, id); }
  @Delete(':id/like') unlike(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.posts.unlike(user.id, id); }
  @Get(':id/comments')
  comments(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Query() query: CommentListQueryDto,
  ) {
    return this.posts.comments(id, query, user.id);
  }
  @Post(':id/comments') comment(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Body() dto: CommentDto) { return this.posts.comment(user.id, id, dto); }
  @Get(':postId/comments/:commentId/replies') replies(
    @CurrentUser() user: AuthUser,
    @UuidParam('postId') postId: string,
    @UuidParam('commentId') commentId: string,
    @Query() query: ReplyListQueryDto,
  ) { return this.posts.replies(postId, commentId, query, user.id); }
  @Patch(':postId/comments/:commentId') updateComment(@CurrentUser() user: AuthUser, @UuidParam('postId') postId: string, @UuidParam('commentId') commentId: string, @Body() dto: UpdateCommentDto) { return this.posts.updateComment(user.id, postId, commentId, dto); }
  @Get(':postId/comments/:commentId/history') commentHistory(@CurrentUser() user: AuthUser, @UuidParam('postId') postId: string, @UuidParam('commentId') commentId: string) { return this.posts.commentHistory(user.id, postId, commentId); }
  @Post(':postId/comments/:commentId/like') likeComment(@CurrentUser() user: AuthUser, @UuidParam('postId') postId: string, @UuidParam('commentId') commentId: string) { return this.posts.likeComment(user.id, postId, commentId); }
  @Delete(':postId/comments/:commentId/like') unlikeComment(@CurrentUser() user: AuthUser, @UuidParam('postId') postId: string, @UuidParam('commentId') commentId: string) { return this.posts.unlikeComment(user.id, postId, commentId); }
  @Delete(':postId/comments/:commentId') @HttpCode(204) removeComment(@CurrentUser() user: AuthUser, @UuidParam('postId') postId: string, @UuidParam('commentId') commentId: string) { return this.posts.removeComment(user.id, postId, commentId); }
}
