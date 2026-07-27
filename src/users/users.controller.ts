import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AllowPendingOnboarding } from '../auth/allow-pending-onboarding.decorator';
import { UuidParam } from '../common/uuid-param.decorator';
import { CompleteUserOnboardingDto, DeleteMeDto, ReportUserDto, SaveSearchHistoryDto, UpdateAccountDto, UpdateMeDto, UpdatePasswordDto, UserFollowingQueryDto, UserSearchHistoryQueryDto, UserSearchQueryDto } from './dto';
import { UsersService } from './users.service';
import { VerifiedAccountGuard } from '../auth/verified-account.guard';
import { AllowUnverifiedMutation } from '../auth/allow-unverified-mutation.decorator';

@UseGuards(JwtAuthGuard, VerifiedAccountGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}
  @AllowPendingOnboarding()
  @Get('me') me(@CurrentUser() user: AuthUser) { return this.users.me(user.id); }
  @Patch('me') @UseGuards(VerifiedAccountGuard) updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) { return this.users.updateMe(user.id, dto); }
  @AllowPendingOnboarding()
  @Patch('me/onboarding') @AllowUnverifiedMutation('Pending users must be able to complete required onboarding.') completeOnboarding(@CurrentUser() user: AuthUser, @Body() dto: CompleteUserOnboardingDto) { return this.users.completeOnboarding(user.id, dto); }
  @AllowPendingOnboarding()
  @Patch('me/account') @AllowUnverifiedMutation('Account and email recovery must remain available to unverified users.') updateAccount(@CurrentUser() user: AuthUser, @Body() dto: UpdateAccountDto) { return this.users.updateAccount(user.id, dto); }
  @AllowPendingOnboarding()
  @Patch('me/password') @AllowUnverifiedMutation('Password recovery and credential hardening must remain available to unverified users.') updatePassword(@CurrentUser() user: AuthUser, @Body() dto: UpdatePasswordDto) { return this.users.updatePassword(user.id, dto); }
  @AllowPendingOnboarding()
  @Delete('me') @AllowUnverifiedMutation('Every user must retain the ability to delete their account.') deleteMe(@CurrentUser() user: AuthUser, @Body() dto: DeleteMeDto) { return this.users.deleteMe(user.id, dto); }
  @AllowPendingOnboarding()
  @Get('me/sessions') sessions(@CurrentUser() user: AuthUser) { return this.users.sessions(user.id, user.loginSessionId); }
  @AllowPendingOnboarding()
  @Delete('me/sessions/:id') @AllowUnverifiedMutation('Session revocation is an account-security control.') revokeSession(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.users.revokeSession(user.id, id); }
  @Get('me/followers') followers(@CurrentUser() user: AuthUser) { return this.users.followers(user.id); }
  @Get('me/following') following(@CurrentUser() user: AuthUser, @Query() query: UserFollowingQueryDto) { return this.users.following(user.id, query.nonFollowback); }
  @Get('me/mutual') mutual(@CurrentUser() user: AuthUser) { return this.users.mutual(user.id); }
  @Get('me/close-buddies') closeBuddies(@CurrentUser() user: AuthUser) { return this.users.closeBuddies(user.id); }
  @Get('me/blocked') blockedUsers(@CurrentUser() user: AuthUser) { return this.users.blockedUsers(user.id); }
  @Get('me/search-history') searchHistory(@CurrentUser() user: AuthUser, @Query() query: UserSearchHistoryQueryDto) {
    return this.users.searchHistory(user.id, query);
  }
  @Post('me/search-history') saveSearchHistory(@CurrentUser() user: AuthUser, @Body() dto: SaveSearchHistoryDto) { return this.users.saveSearchHistory(user.id, dto); }
  @Delete('me/search-history') clearSearchHistory(@CurrentUser() user: AuthUser) { return this.users.clearSearchHistory(user.id); }
  @Delete('me/search-history/:id') removeSearchHistory(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.users.removeSearchHistory(user.id, id); }
  @Get('me/follow-requests') incomingFollowRequests(@CurrentUser() user: AuthUser) { return this.users.incomingFollowRequests(user.id); }
  @Get('me/follow-requests/sent') sentFollowRequests(@CurrentUser() user: AuthUser) { return this.users.sentFollowRequests(user.id); }
  @Post('me/follow-requests/:id/accept') acceptFollowRequest(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.users.acceptFollowRequest(user.id, id); }
  @Post('me/follow-requests/:id/decline') declineFollowRequest(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.users.declineFollowRequest(user.id, id); }
  @Delete('me/follow-requests/:id') cancelFollowRequest(@CurrentUser() user: AuthUser, @UuidParam('id') id: string) { return this.users.cancelFollowRequest(user.id, id); }
  @Get() search(@CurrentUser() user: AuthUser, @Query() query: UserSearchQueryDto) {
    return this.users.search(user.id, query.q, { take: query.take, cursor: query.cursor });
  }
  @Post(':id/close-buddy') addCloseBuddy(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.addCloseBuddy(user.id, id); }
  @Delete(':id/close-buddy') removeCloseBuddy(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.removeCloseBuddy(user.id, id); }
  @Get(':id/followers') profileFollowers(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.profileFollowers(id, user.id); }
  @Get(':id/following') profileFollowing(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.profileFollowing(id, user.id); }
  @Post(':id/follow') follow(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.follow(user.id, id); }
  @Delete(':id/follow') unfollow(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.unfollow(user.id, id); }
  @Post(':id/block') @AllowUnverifiedMutation('Blocking remains available as an immediate user-safety control.') block(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.block(user.id, id); }
  @Delete(':id/block') @AllowUnverifiedMutation('Users may reverse their own safety block before verification.') unblock(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.unblock(user.id, id); }
  @Post(':id/report') @AllowUnverifiedMutation('Safety reports remain available before email verification.') report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReportUserDto) { return this.users.report(user.id, id, dto); }
  @Get(':id') profile(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.profile(user.id, id); }

}
