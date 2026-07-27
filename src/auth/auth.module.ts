import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { JwtStrategy } from './jwt.strategy';
import { TurnstileService } from './turnstile.service';
import { EmailVerificationService } from './email-verification.service';
import { VerifiedAccountGuard } from './verified-account.guard';

@Module({
  imports: [PassportModule, JwtModule.register({}), MailModule, NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, VerifiedAccountGuard, TurnstileService, EmailVerificationService],
  exports: [JwtAuthGuard, VerifiedAccountGuard, EmailVerificationService],
})
export class AuthModule {}
