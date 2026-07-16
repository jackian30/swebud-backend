import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { AuthService, sessionMetadataFromRequest } from './auth.service';
import { CompleteOnboardingDto, ForgotPasswordDto, GoogleLoginDto, LoginDto, LogoutDto, RefreshDto, RegisterDto, ResetPasswordDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';
import { AllowPendingOnboarding } from './allow-pending-onboarding.decorator';
import { authTransportMode, clearWebRefreshCookie, presentAuthSession, refreshCredential } from './auth-session-transport';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private config: ConfigService) {}

  @Post('register') register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.issueSession(req, res, () => this.auth.register(dto, sessionMetadataFromRequest(req)));
  }
  @Post('login') @HttpCode(200) login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.issueSession(req, res, () => this.auth.login(dto, sessionMetadataFromRequest(req)));
  }
  @Post('google') @HttpCode(200) google(@Body() dto: GoogleLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.issueSession(req, res, () => this.auth.googleLogin(dto, sessionMetadataFromRequest(req)));
  }
  @UseGuards(JwtAuthGuard)
  @AllowPendingOnboarding()
  @Post('onboarding/complete') @HttpCode(200) completeOnboarding(
    @CurrentUser() user: AuthUser,
    @Body() dto: CompleteOnboardingDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issueSession(req, res, () => this.auth.completeOnboarding(
        user.id,
        dto,
        sessionMetadataFromRequest(req),
        user.loginSessionId,
        user.sessionId,
      ));
  }
  @Post('refresh') @HttpCode(200) async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credential = refreshCredential(req, dto.refreshToken, this.config);
    const session = await this.auth.refresh(credential.token!, sessionMetadataFromRequest(req));
    return presentAuthSession(session, credential.mode, res, this.config);
  }
  @Post('forgot-password') @HttpCode(200) forgotPassword(@Body() dto: ForgotPasswordDto) { return this.auth.forgotPassword(dto.email); }
  @Post('reset-password') @HttpCode(200) resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.token, dto.password); }

  @UseGuards(JwtAuthGuard)
  @AllowPendingOnboarding()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credential = refreshCredential(req, dto.refreshToken, this.config, { allowMissing: true });
    await this.auth.logout(user.id, credential.token, user.loginSessionId);
    if (credential.mode === 'web') clearWebRefreshCookie(res, this.config);
  }

  private async issueSession(req: Request, res: Response, issue: () => Promise<{ refreshToken: string } & Record<string, unknown>>) {
    const mode = authTransportMode(req, this.config);
    const session = await issue();
    return presentAuthSession(session, mode, res, this.config);
  }
}
