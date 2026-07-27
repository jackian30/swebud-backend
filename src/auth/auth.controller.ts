import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { AuthService, sessionMetadataFromRequest } from './auth.service';
import { CompleteOnboardingDto, ForgotPasswordDto, GoogleLoginDto, LoginDto, LogoutDto, RefreshDto, RegisterDto, ResendVerificationDto, ResetPasswordDto, VerifyEmailDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';
import { AllowPendingOnboarding } from './allow-pending-onboarding.decorator';
import { authTransportMode, clearWebRefreshCookie, presentAuthSession, refreshCredential } from './auth-session-transport';
import { AllowUnverifiedMutation } from './allow-unverified-mutation.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private config: ConfigService) {}

  @Get('policy') policy() { return this.auth.policy(); }
  @Post('register') @AllowUnverifiedMutation('Registration necessarily precedes email verification.') register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.issueSession(req, res, (metadata) => this.auth.register(dto, metadata));
  }
  @Post('login') @HttpCode(200) @AllowUnverifiedMutation('Login must remain available so users can verify or recover an account.') login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.issueSession(req, res, (metadata) => this.auth.login(dto, metadata));
  }
  @Post('google') @HttpCode(200) @AllowUnverifiedMutation('Federated authentication necessarily precedes local verification checks.') google(@Body() dto: GoogleLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.issueSession(req, res, (metadata) => this.auth.googleLogin(dto, metadata));
  }
  @UseGuards(JwtAuthGuard)
  @AllowPendingOnboarding()
  @AllowUnverifiedMutation('Pending users must be able to complete required onboarding.')
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
  @Post('refresh') @HttpCode(200) @AllowUnverifiedMutation('Session refresh must remain available while completing verification.') async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credential = refreshCredential(req, dto?.refreshToken, this.config);
    const session = await this.auth.refresh(credential.token!, sessionMetadataFromRequest(req));
    return presentAuthSession(session, credential.mode, res, this.config);
  }
  @Post('forgot-password') @HttpCode(200) @AllowUnverifiedMutation('Password recovery must remain available without a verified session.') forgotPassword(@Body() dto: ForgotPasswordDto) { return this.auth.forgotPassword(dto.email); }
  @Post('reset-password') @HttpCode(200) @AllowUnverifiedMutation('Password recovery must remain available without a verified session.') resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.token, dto.password); }
  @Post('verify-email') @HttpCode(200) @AllowUnverifiedMutation('The verification endpoint necessarily accepts unverified users.') verifyEmail(@Body() dto: VerifyEmailDto) { return this.auth.verifyEmail(dto.token); }
  @Post('resend-verification') @HttpCode(200) @AllowUnverifiedMutation('Unverified users must be able to request a replacement verification message.') resendVerification(@Body() dto?: ResendVerificationDto) {
    return this.auth.resendEmailVerification(dto?.email);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPendingOnboarding()
  @AllowUnverifiedMutation('Logout and session invalidation are always available.')
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credential = refreshCredential(req, dto?.refreshToken, this.config, { allowMissing: true });
    await this.auth.logout(user.id, credential.token, user.loginSessionId);
    if (credential.mode !== 'native') clearWebRefreshCookie(res, this.config);
  }

  private async issueSession(
    req: Request,
    res: Response,
    issue: (metadata: ReturnType<typeof sessionMetadataFromRequest>) => Promise<{ refreshToken: string } & Record<string, unknown>>,
  ) {
    const mode = authTransportMode(req, this.config);
    const metadata = sessionMetadataFromRequest(req);
    metadata.legacyNativeClient = mode === 'native' && !req.get('x-swebudd-client');
    const session = await issue(metadata);
    return presentAuthSession(session, mode, res, this.config);
  }
}
