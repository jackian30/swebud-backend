import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { VerifiedAccountGuard } from '../auth/verified-account.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { UpdateThemeDto } from './dto';
import { ThemeService } from './theme.service';

@UseGuards(JwtAuthGuard, VerifiedAccountGuard)
@Controller('theme')
export class ThemeController {
  constructor(private theme: ThemeService) {}
  @Get() get(@CurrentUser() user: AuthUser) { return this.theme.get(user.id); }
  @Put() update(@CurrentUser() user: AuthUser, @Body() dto: UpdateThemeDto) { return this.theme.update(user.id, dto); }
}
