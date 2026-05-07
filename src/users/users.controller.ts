import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CompleteUserOnboardingDto, ReportUserDto, UpdateAccountDto, UpdateMeDto, UpdatePasswordDto } from './dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}
  @Get('me') me(@CurrentUser() user: AuthUser) { return this.users.me(user.id); }
  @Patch('me') updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) { return this.users.updateMe(user.id, dto); }
  @Patch('me/onboarding') completeOnboarding(@CurrentUser() user: AuthUser, @Body() dto: CompleteUserOnboardingDto) { return this.users.completeOnboarding(user.id, dto); }
  @Patch('me/account') updateAccount(@CurrentUser() user: AuthUser, @Body() dto: UpdateAccountDto) { return this.users.updateAccount(user.id, dto); }
  @Patch('me/password') updatePassword(@CurrentUser() user: AuthUser, @Body() dto: UpdatePasswordDto) { return this.users.updatePassword(user.id, dto); }
  @Get('me/sessions') sessions(@CurrentUser() user: AuthUser) { return this.users.sessions(user.id, user.sessionId); }
  @Delete('me/sessions/:id') revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.revokeSession(user.id, id); }
  @Get('me/followers') followers(@CurrentUser() user: AuthUser) { return this.users.followers(user.id); }
  @Get('me/following') following(@CurrentUser() user: AuthUser, @Query('nonFollowback') nonFollowback?: string) { return this.users.following(user.id, nonFollowback); }
  @Get('me/mutual') mutual(@CurrentUser() user: AuthUser) { return this.users.mutual(user.id); }
  @Get('me/close-buddies') closeBuddies(@CurrentUser() user: AuthUser) { return this.users.closeBuddies(user.id); }
  @Get('me/follow-requests') incomingFollowRequests(@CurrentUser() user: AuthUser) { return this.users.incomingFollowRequests(user.id); }
  @Get('me/follow-requests/sent') sentFollowRequests(@CurrentUser() user: AuthUser) { return this.users.sentFollowRequests(user.id); }
  @Post('me/follow-requests/:id/accept') acceptFollowRequest(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.acceptFollowRequest(user.id, id); }
  @Post('me/follow-requests/:id/decline') declineFollowRequest(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.declineFollowRequest(user.id, id); }
  @Delete('me/follow-requests/:id') cancelFollowRequest(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.cancelFollowRequest(user.id, id); }
  @Get() search(@Query('q') q?: string) { return this.users.search(q); }
  @Post(':id/close-buddy') addCloseBuddy(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.addCloseBuddy(user.id, id); }
  @Delete(':id/close-buddy') removeCloseBuddy(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.removeCloseBuddy(user.id, id); }
  @Get(':id/followers') profileFollowers(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.profileFollowers(id, user.id); }
  @Get(':id/following') profileFollowing(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.profileFollowing(id, user.id); }
  @Post(':id/follow') follow(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.follow(user.id, id); }
  @Delete(':id/follow') unfollow(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.unfollow(user.id, id); }
  @Post(':id/block') block(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.block(user.id, id); }
  @Delete(':id/block') unblock(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.unblock(user.id, id); }
  @Post(':id/report') report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReportUserDto) { return this.users.report(user.id, id, dto); }
  @Get(':id') profile(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.profile(user.id, id); }
}
