import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminDatabaseQueryDto, AdminListQueryDto, AdminUpdateGroupDto, AdminUpdatePostDto, AdminUpdateRecordDto, AdminUpdateUserDto } from './dto';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('me') me(@CurrentUser() user: AuthUser) { return this.admin.me(user.id); }
  @Get('stats') stats() { return this.admin.stats(); }
  @Get('analytics') analytics() { return this.admin.analytics(); }
  @Get('roles') roles() { return this.admin.roles(); }

  @Get('users') users(@Query() query: AdminListQueryDto) { return this.admin.listUsers(query); }
  @Get('users/:id') user(@Param('id') id: string) { return this.admin.getUser(id); }
  @Patch('users/:id') updateUser(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AdminUpdateUserDto) { return this.admin.updateUser(user.id, id, dto); }
  @Delete('users/:id') deleteUser(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.admin.deleteUser(user.id, id); }
  @Post('users/:id/revoke-sessions') revokeUserSessions(@Param('id') id: string) { return this.admin.revokeUserSessions(id); }

  @Get('posts') posts(@Query() query: AdminListQueryDto) { return this.admin.listPosts(query); }
  @Patch('posts/:id') updatePost(@Param('id') id: string, @Body() dto: AdminUpdatePostDto) { return this.admin.updatePost(id, dto); }
  @Delete('posts/:id') deletePost(@Param('id') id: string) { return this.admin.deletePost(id); }

  @Get('groups') groups(@Query() query: AdminListQueryDto) { return this.admin.listGroups(query); }
  @Patch('groups/:id') updateGroup(@Param('id') id: string, @Body() dto: AdminUpdateGroupDto) { return this.admin.updateGroup(id, dto); }
  @Delete('groups/:id') deleteGroup(@Param('id') id: string) { return this.admin.deleteGroup(id); }

  @Get('reports') reports() { return this.admin.reports(); }
  @Delete('reports/posts/:id') resolvePostReport(@Param('id') id: string) { return this.admin.resolvePostReport(id); }
  @Delete('reports/users/:id') resolveUserReport(@Param('id') id: string) { return this.admin.resolveUserReport(id); }

  @Get('database/tables') databaseTables() { return this.admin.databaseTables(); }
  @Get('database/:table') databaseRows(@Param('table') table: string, @Query() query: AdminDatabaseQueryDto) { return this.admin.databaseRows(table, query); }
  @Patch('database/:table/:recordKey') updateDatabaseRecord(@Param('table') table: string, @Param('recordKey') recordKey: string, @Body() dto: AdminUpdateRecordDto) {
    return this.admin.updateDatabaseRecord(table, recordKey, dto);
  }
  @Delete('database/:table/:recordKey') deleteDatabaseRecord(@Param('table') table: string, @Param('recordKey') recordKey: string) {
    return this.admin.deleteDatabaseRecord(table, recordKey);
  }
}
