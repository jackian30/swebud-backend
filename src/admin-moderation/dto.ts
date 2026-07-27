import {
  ModerationReportType,
  ReportAppealStatus,
  ReportCategory,
  ReportStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsOptionalNonNull, IsOptionalOrNull } from '../common/validation';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const queryBoolean = ({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value;

export class AdminReportQueryDto {
  @IsOptionalNonNull() @IsEnum(ModerationReportType) type?: ModerationReportType;
  @IsOptionalNonNull() @IsEnum(ReportStatus) status?: ReportStatus;
  @IsOptionalNonNull() @IsEnum(ReportCategory) category?: ReportCategory;
  @IsOptionalNonNull() @Transform(trim) @IsString() @MaxLength(128) assignedReviewerId?: string;
  @IsOptionalNonNull() @Transform(queryBoolean) @IsBoolean() escalated?: boolean;
  @IsOptionalNonNull() @Transform(queryBoolean) @IsBoolean() overdue?: boolean;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(1000) cursor?: number;
}

export class UpdateAdminReportDto {
  @IsEnum(ReportStatus) status!: ReportStatus;
  @IsOptionalNonNull() @Transform(trim) @IsString() @MaxLength(500) actionTaken?: string;
  @IsOptionalNonNull() @Transform(trim) @IsString() @MaxLength(2000) resolutionNote?: string;
}

export class AssignAdminReportDto {
  @IsOptionalOrNull() @Transform(trim) @IsString() @MaxLength(128) reviewerId?: string | null;
  @IsOptionalOrNull() @IsDateString() slaDueAt?: string | null;
}

export class AddAdminReportNoteDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

export class EscalateAdminReportDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) level!: number;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(100) priority?: number;
  @IsOptionalOrNull() @IsDateString() slaDueAt?: string | null;
}

export class CreateAdminAppealDto {
  @IsOptionalNonNull() @IsUUID() appellantUserId?: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) statement!: string;
}

export class ReviewAdminAppealDto {
  @IsIn([
    ReportAppealStatus.under_review,
    ReportAppealStatus.upheld,
    ReportAppealStatus.overturned,
    ReportAppealStatus.dismissed,
    ReportAppealStatus.withdrawn,
  ])
  status!: ReportAppealStatus;
  @IsOptionalOrNull() @Transform(trim) @IsString() @MaxLength(128) reviewerId?: string | null;
  @IsOptionalNonNull() @Transform(trim) @IsString() @MaxLength(2000) resolutionNote?: string;
}

export class CreateAdminEvidenceDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1024) storageKey!: string;
  @Matches(/^[a-f0-9]{64}$/i) sha256!: string;
  @Transform(trim) @IsString() @Matches(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i) @MaxLength(200) mediaType!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647) byteSize!: number;
  @IsObject() metadata!: Record<string, unknown>;
  @IsDateString() retentionExpiresAt!: string;
  @IsOptionalNonNull() @IsBoolean() legalHold?: boolean;
}

export class UpdateAdminEvidenceRetentionDto {
  @IsOptionalNonNull() @IsDateString() retentionExpiresAt?: string;
  @IsOptionalNonNull() @IsBoolean() legalHold?: boolean;
  @IsOptionalNonNull() @IsObject() metadata?: Record<string, unknown>;
}

export class BanAdminUserDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
  @IsOptionalNonNull() @IsDateString() bannedUntil?: string;
}

export class UnbanAdminUserDto {
  @IsOptionalNonNull() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}

export class RevokeAdminUserSessionsDto {
  @IsOptionalNonNull() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}

export class QuarantineAdminContentDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

export class RestoreAdminContentDto {
  @IsOptionalNonNull() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}
