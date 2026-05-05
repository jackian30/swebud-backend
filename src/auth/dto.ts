import { Type } from 'class-transformer';
import { ActivityPersona, UserGender } from '@prisma/client';
import { IsArray, IsBoolean, IsDate, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(3) username!: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsEnum(UserGender) gender?: UserGender;
  @Type(() => Date) @IsDate() dateOfBirth!: Date;
  @IsOptional() @IsEnum(ActivityPersona) activityPersona?: ActivityPersona;
  @IsOptional() @IsArray() @IsEnum(ActivityPersona, { each: true }) activityPersonas?: ActivityPersona[];
  @IsOptional() @IsString() captchaToken?: string;
  @IsBoolean() legalConsent!: boolean;
  @IsBoolean() dataConsent!: boolean;
}
export class GoogleLoginDto {
  @IsString() idToken!: string;
}
export class CompleteOnboardingDto {
  @IsString() @MinLength(3) username!: string;
  @Type(() => Date) @IsDate() dateOfBirth!: Date;
  @IsBoolean() legalConsent!: boolean;
  @IsBoolean() dataConsent!: boolean;
  @IsOptional() @IsArray() @IsEnum(ActivityPersona, { each: true }) activityPersonas?: ActivityPersona[];
}
export class LoginDto {
  @IsString() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() captchaToken?: string;
}
export class RefreshDto { @IsString() refreshToken!: string; }
export class LogoutDto { @IsOptional() @IsString() refreshToken?: string; }
export class ForgotPasswordDto { @IsEmail() email!: string; }
export class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(8) password!: string;
}
