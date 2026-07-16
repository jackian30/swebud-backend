import { Transform, Type } from 'class-transformer';
import { ActivityPersona, PostVisibility, ProfileVisibility, ReportCategory, UserGender, UserReportReason } from '@prisma/client';
import { IsArray, IsBoolean, IsDate, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsOptionalNonNull, IsOptionalOrNull } from '../common/validation';

const normalizeQueryString = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const normalizeQueryBoolean = ({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value;

export class UserFollowingQueryDto {
  @IsOptionalNonNull() @Transform(normalizeQueryBoolean) @IsBoolean() nonFollowback?: boolean;
}

export class UserSearchQueryDto {
  @IsOptionalNonNull() @Transform(normalizeQueryString) @IsString() @MaxLength(120) q?: string;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) cursor?: number;
}

export class UserSearchHistoryQueryDto {
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(1000) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(1000) cursor?: number;
}

export class UpdateMeDto {
  @IsOptionalNonNull() @IsString() displayName?: string;
  @IsOptionalNonNull() @IsString() @MinLength(3) @MaxLength(32) username?: string;
  @IsOptionalOrNull() @IsString() bio?: string | null;
  @IsOptionalOrNull() @IsString() profileImageUrl?: string | null;
  @IsOptionalOrNull() @IsString() coverImageUrl?: string | null;
  @IsOptionalOrNull() @IsEnum(UserGender) gender?: UserGender | null;
  @IsOptionalOrNull() @Type(() => Date) @IsDate() dateOfBirth?: Date | null;
  @IsOptionalOrNull() @IsEnum(ActivityPersona) activityPersona?: ActivityPersona | null;
  @IsOptionalNonNull() @IsArray() @IsEnum(ActivityPersona, { each: true }) activityPersonas?: ActivityPersona[];
  @IsOptionalNonNull() @IsEnum(ProfileVisibility) profileVisibility?: ProfileVisibility;
  @IsOptionalNonNull() @IsEnum(PostVisibility) defaultPostVisibility?: PostVisibility;
  @IsOptionalNonNull() @IsBoolean() hideProfileBadges?: boolean;
  @IsOptionalNonNull() @IsArray() @IsString({ each: true }) hiddenProfileBadgeCodes?: string[];
  @IsOptionalOrNull() @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @IsOptionalOrNull() @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
}

export class CompleteUserOnboardingDto {
  @IsString() @MinLength(3) username!: string;
  @Type(() => Date) @IsDate() dateOfBirth!: Date;
  @IsBoolean() legalConsent!: boolean;
  @IsBoolean() dataConsent!: boolean;
  @IsOptionalNonNull() @IsArray() @IsEnum(ActivityPersona, { each: true }) activityPersonas?: ActivityPersona[];
}

export class UpdateAccountDto {
  @IsEmail() email!: string;
  @IsString() currentPassword!: string;
}

export class UpdatePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

export class DeleteMeDto {
  @IsString() @MinLength(1) @MaxLength(80) confirmation!: string;
}

export class ReportUserDto {
  @IsOptionalNonNull() @IsEnum(UserReportReason) reason?: UserReportReason;
  @IsOptionalNonNull() @IsEnum(ReportCategory) category?: ReportCategory;
  @IsOptionalNonNull() @IsString() @MaxLength(1000) note?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(1000) details?: string;
}

export class SaveSearchHistoryDto {
  @IsIn(['term', 'user']) type!: 'term' | 'user';
  @IsOptionalNonNull() @IsString() @MaxLength(120) term?: string;
  @IsOptionalNonNull() @IsUUID() targetUserId?: string;
  @IsOptionalOrNull() @IsString() @MaxLength(120) displayName?: string | null;
  @IsOptionalOrNull() @IsString() @MaxLength(64) username?: string | null;
  @IsOptionalOrNull() @IsString() @MaxLength(1000) profileImageUrl?: string | null;
}
