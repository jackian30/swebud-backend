import { Transform, Type } from 'class-transformer';
import { GroupReportReason, ReportCategory } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsString, IsTimeZone, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsOptionalNonNull, IsOptionalOrNull } from '../common/validation';

function normalizeGroupSlug(value: unknown) {
  if (typeof value !== 'string') return value;
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const normalizeQueryString = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const normalizeQueryBoolean = ({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value;

export class GroupListQueryDto {
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) cursor?: number;
  @IsOptionalNonNull() @Transform(normalizeQueryBoolean) @IsBoolean() discover?: boolean;
}

export class GroupMineQueryDto {
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) cursor?: number;
}

export class GroupSummaryQueryDto {
  @IsOptionalNonNull() @Transform(normalizeQueryBoolean) @IsBoolean() summary?: boolean;
}

export class GroupInviteCandidatesQueryDto {
  @IsOptionalNonNull() @Transform(normalizeQueryString) @IsString() @MaxLength(120) q?: string;
}

export class GroupPostsQueryDto {
  @IsOptionalNonNull() @IsIn(['latest', 'trending', 'most-commented', 'oldest']) sort?: 'latest' | 'trending' | 'most-commented' | 'oldest';
  @IsOptionalNonNull() @Transform(normalizeQueryString) @IsString() @MaxLength(500) hashtag?: string;
  @IsOptionalNonNull() @Transform(normalizeQueryString) @IsString() @MaxLength(120) q?: string;
  @IsOptionalNonNull() @Transform(normalizeQueryBoolean) @IsBoolean() mine?: boolean;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) cursor?: number;
  @IsOptionalNonNull() @Transform(normalizeQueryString) @IsString() @MaxLength(100) @IsTimeZone() timezone?: string;
}

export class CreateGroupDto {
  @IsString() @MaxLength(120) name!: string;
  @Transform(({ value }) => normalizeGroupSlug(value))
  @IsString()
  @Matches(/^[a-z0-9-]{3,60}$/, { message: 'Slug must be 3-60 characters after cleanup. Use letters, numbers, or hyphens.' })
  slug!: string;
  @IsOptionalNonNull() @IsString() @MaxLength(500) description?: string;
  @IsOptionalNonNull() @IsIn(['public', 'private']) visibility?: 'public' | 'private';
  @IsOptionalNonNull() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) inviteUserIds?: string[];
}

export class InviteGroupUsersDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class AcceptGroupInviteCodeDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString()
  @Matches(/^[a-f0-9]{12}$/, { message: 'Invalid group invite code.' })
  code!: string;
}

export class UpdateGroupSettingsDto {
  @IsOptionalNonNull() @IsString() @MaxLength(120) name?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(500) description?: string;
  @IsOptionalNonNull() @IsString() profileImageUrl?: string;
  @IsOptionalNonNull() @IsString() coverImageUrl?: string;
  @IsOptionalNonNull() @IsIn(['public', 'private']) visibility?: 'public' | 'private';
  @IsOptionalNonNull() @IsBoolean() allowAnonymousPosts?: boolean;
}

export class UpdateGroupRoleDto { @IsIn(['owner', 'admin', 'moderator', 'member']) role!: 'owner' | 'admin' | 'moderator' | 'member'; }

export class GroupPostImageDto {
  @IsString() url!: string;
  @IsOptionalNonNull() @IsString() alt?: string;
  @IsOptionalNonNull() @IsIn(['image', 'video']) type?: 'image' | 'video';
  @IsOptionalNonNull() @IsIn(['image', 'video']) mediaType?: 'image' | 'video';
  @IsOptionalNonNull() @IsString() mimeType?: string;
  @IsOptionalNonNull() @IsString() filename?: string;
  @IsOptionalNonNull() @IsNumber() size?: number;
  @IsOptionalNonNull() @IsNumber() width?: number;
  @IsOptionalNonNull() @IsNumber() height?: number;
}

export class GroupPostDto {
  @IsOptionalNonNull() @IsString() @MaxLength(1000) text?: string;
  @IsOptionalNonNull() @IsBoolean() anonymous?: boolean;
  @IsOptionalNonNull() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => GroupPostImageDto) images?: GroupPostImageDto[];
}

export class GroupMessageDto {
  @IsString() @MaxLength(1000) body!: string;
  @IsOptionalNonNull() @IsIn(['message']) referenceType?: 'message';
  @IsOptionalNonNull() @IsString() @MaxLength(120) referenceId?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(500) referenceText?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(120) referenceAuthorName?: string;
}

export class GroupChatMuteDto { @IsBoolean() muted!: boolean; @IsOptionalOrNull() @IsDateString() mutedUntil?: string | null; }
export class GroupChatPinDto { @IsBoolean() pinned!: boolean; }

export class CreateGroupChannelDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9 -]{1,38}[a-z0-9]$/i) name!: string;
  @IsOptionalNonNull() @IsString() @MaxLength(160) description?: string;
  @IsOptionalNonNull() @IsIn(['public', 'private']) visibility?: 'public' | 'private';
  @IsOptionalNonNull() @IsIn(['everyone', 'moderators', 'admins']) messagePolicy?: 'everyone' | 'moderators' | 'admins';
  @IsOptionalNonNull() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) memberIds?: string[];
}

export class ReportGroupDto {
  @IsOptionalNonNull() @IsEnum(GroupReportReason) reason?: GroupReportReason;
  @IsOptionalNonNull() @IsEnum(ReportCategory) category?: ReportCategory;
  @IsOptionalNonNull() @IsString() @MaxLength(1000) note?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(1000) details?: string;
}
