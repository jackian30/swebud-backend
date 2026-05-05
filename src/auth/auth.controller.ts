import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { AuthService } from './auth.service';
import { CompleteOnboardingDto, ForgotPasswordDto, GoogleLoginDto, LoginDto, LogoutDto, RefreshDto, RegisterDto, ResetPasswordDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register') register(@Body() dto: RegisterDto, @Req() req: Request) { return this.auth.register(dto, req.ip); }
  @Post('login') @HttpCode(200) login(@Body() dto: LoginDto, @Req() req: Request) { return this.auth.login(dto, req.ip); }
  @Post('google') @HttpCode(200) google(@Body() dto: GoogleLoginDto) { return this.auth.googleLogin(dto); }
  @UseGuards(JwtAuthGuard)
  @Post('onboarding/complete') @HttpCode(200) completeOnboarding(@CurrentUser() user: AuthUser, @Body() dto: CompleteOnboardingDto) { return this.auth.completeOnboarding(user.id, dto); }
  @Post('refresh') @HttpCode(200) refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }
  @Post('forgot-password') @HttpCode(200) forgotPassword(@Body() dto: ForgotPasswordDto) { return this.auth.forgotPassword(dto.email); }
  @Post('reset-password') @HttpCode(200) resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.token, dto.password); }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto) { await this.auth.logout(user.id, dto.refreshToken); }
}
