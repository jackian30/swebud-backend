import { Type } from 'class-transformer';
import { ActivityPersona, UserGender } from '@prisma/client';
import { IsArray, IsBoolean, IsDate, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsString() @MinLength(3) @MaxLength(32) username!: string;
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
  @IsOptional() @IsEnum(UserGender) gender?: UserGender;
  @Type(() => Date) @IsDate() dateOfBirth!: Date;
  @IsOptional() @IsEnum(ActivityPersona) activityPersona?: ActivityPersona;
  @IsOptional() @IsArray() @IsEnum(ActivityPersona, { each: true }) activityPersonas?: ActivityPersona[];
  @IsOptional() @IsString() @MaxLength(4096) captchaToken?: string;
  @IsBoolean() legalConsent!: boolean;
  @IsBoolean() dataConsent!: boolean;
}
export class GoogleLoginDto {
  @IsString() @MaxLength(4096) idToken!: string;
}
export class CompleteOnboardingDto {
  @IsString() @MinLength(3) @MaxLength(32) username!: string;
  @Type(() => Date) @IsDate() dateOfBirth!: Date;
  @IsBoolean() legalConsent!: boolean;
  @IsBoolean() dataConsent!: boolean;
  @IsOptional() @IsArray() @IsEnum(ActivityPersona, { each: true }) activityPersonas?: ActivityPersona[];
}
export class LoginDto {
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsOptional() @IsString() @MaxLength(4096) captchaToken?: string;
}
export class RefreshDto { @IsString() @MaxLength(4096) refreshToken!: string; }
export class LogoutDto { @IsOptional() @IsString() @MaxLength(4096) refreshToken?: string; }
export class ForgotPasswordDto { @IsEmail() @MaxLength(254) email!: string; }
export class ResetPasswordDto {
  @IsString() @MaxLength(256) token!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
