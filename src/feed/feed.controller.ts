import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { FeedHashtagQueryDto, FeedQueryDto, FeedViewedDto } from './dto';
import { FeedService } from './feed.service';

@UseGuards(JwtAuthGuard)
@Controller('feed')
export class FeedController {
  constructor(private feedService: FeedService) {}
  @Get('hashtags') hashtags(@Query() query: FeedHashtagQueryDto) { return this.feedService.hashtags(query.q); }
  @Get('trending-hashtags') trendingHashtags() { return this.feedService.trendingHashtags(); }
  @Get('suggested-users') suggestedUsers(@CurrentUser() user: AuthUser) { return this.feedService.suggestedUsers(user.id); }
  @Get('suggested-groups') suggestedGroups(@CurrentUser() user: AuthUser) { return this.feedService.suggestedGroups(user.id); }
  @Post('viewed') viewed(@CurrentUser() user: AuthUser, @Body() dto: FeedViewedDto) {
    return this.feedService.markViewed(user.id, dto.postIds);
  }

  @Get() feed(@CurrentUser() user: AuthUser, @Query() query: FeedQueryDto) {
    return this.feedService.feed(user.id, {
      take: query.take,
      hashtag: query.hashtag,
      cursor: query.cursor,
      sort: query.sort,
      followingOnly: query.followingOnly === 'true' || query.tab === 'following',
      savedOnly: query.tab === 'saved',
      timezone: query.timezone,
    });
  }
}
