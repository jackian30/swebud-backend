import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { FeedService } from './feed.service';

@UseGuards(JwtAuthGuard)
@Controller('feed')
export class FeedController {
  constructor(private feedService: FeedService) {}
  @Get('hashtags') hashtags(@Query('q') q?: string) { return this.feedService.hashtags(q); }
  @Get('trending-hashtags') trendingHashtags() { return this.feedService.trendingHashtags(); }
  @Get('suggested-users') suggestedUsers(@CurrentUser() user: AuthUser) { return this.feedService.suggestedUsers(user.id); }
  @Get('suggested-groups') suggestedGroups(@CurrentUser() user: AuthUser) { return this.feedService.suggestedGroups(user.id); }
  @Get() feed(
    @CurrentUser() user: AuthUser,
    @Query('take') take?: string,
    @Query('cursor') cursor?: string,
    @Query('hashtag') hashtag?: string,
    @Query('sort') sort?: 'relevance' | 'latest' | 'trending' | 'unseen' | 'time',
    @Query('followingOnly') followingOnly?: string,
    @Query('tab') tab?: 'for-you' | 'following' | 'saved',
  ) {
    const parsedTake = take ? Number.parseInt(take, 10) : undefined;
    const parsedCursor = cursor ? Number.parseInt(cursor, 10) : undefined;
    return this.feedService.feed(user.id, {
      take: Number.isFinite(parsedTake) ? parsedTake : undefined,
      hashtag,
      cursor: Number.isFinite(parsedCursor) ? parsedCursor : undefined,
      sort,
      followingOnly: followingOnly === 'true' || tab === 'following',
      savedOnly: tab === 'saved',
    });
  }
}
