import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { UpdateMeDto } from './dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}
  @Get('me') me(@CurrentUser() user: AuthUser) { return this.users.me(user.id); }
  @Patch('me') updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) { return this.users.updateMe(user.id, dto); }
  @Get('me/followers') followers(@CurrentUser() user: AuthUser) { return this.users.followers(user.id); }
  @Get('me/following') following(@CurrentUser() user: AuthUser, @Query('nonFollowback') nonFollowback?: string) { return this.users.following(user.id, nonFollowback); }
  @Get('me/mutual') mutual(@CurrentUser() user: AuthUser) { return this.users.mutual(user.id); }
  @Get() search(@Query('q') q?: string) { return this.users.search(q); }
  @Post(':id/follow') follow(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.follow(user.id, id); }
  @Delete(':id/follow') unfollow(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.unfollow(user.id, id); }
  @Post(':id/block') block(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.block(user.id, id); }
  @Delete(':id/block') unblock(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.unblock(user.id, id); }
  @Get(':id') profile(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.users.profile(user.id, id); }
}
