import { Type } from 'class-transformer';
import { ActivityPersona, PostVisibility, ProfileVisibility, UserGender, UserReportReason } from '@prisma/client';
import { IsArray, IsBoolean, IsDate, IsEmail, IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(32) username?: string;
  @IsOptional() @IsString() bio?: string;
  @IsOptional() @IsString() profileImageUrl?: string;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsEnum(UserGender) gender?: UserGender;
  @IsOptional() @Type(() => Date) @IsDate() dateOfBirth?: Date;
  @IsOptional() @IsEnum(ActivityPersona) activityPersona?: ActivityPersona;
  @IsOptional() @IsArray() @IsEnum(ActivityPersona, { each: true }) activityPersonas?: ActivityPersona[];
  @IsOptional() @IsEnum(ProfileVisibility) profileVisibility?: ProfileVisibility;
  @IsOptional() @IsEnum(PostVisibility) defaultPostVisibility?: PostVisibility;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
}

export class CompleteUserOnboardingDto {
  @IsString() @MinLength(3) username!: string;
  @Type(() => Date) @IsDate() dateOfBirth!: Date;
  @IsBoolean() legalConsent!: boolean;
  @IsBoolean() dataConsent!: boolean;
  @IsOptional() @IsArray() @IsEnum(ActivityPersona, { each: true }) activityPersonas?: ActivityPersona[];
}

export class UpdateAccountDto {
  @IsEmail() email!: string;
  @IsString() currentPassword!: string;
}

export class UpdatePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

export class ReportUserDto {
  @IsOptional() @IsEnum(UserReportReason) reason?: UserReportReason;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
