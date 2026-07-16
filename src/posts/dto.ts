import { Transform, Type } from 'class-transformer';
import { PostReportReason, PostVisibility, ReportCategory } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsInt, IsNumber, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

const normalizeTaggedUsers = ({ value }: { value: unknown }) => Array.isArray(value)
  ? value.map((item) => (typeof item === 'string' ? item : (item as { id?: unknown; userId?: unknown })?.id ?? (item as { userId?: unknown })?.userId)).filter(Boolean)
  : value;

export class PostListQueryDto {
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) take?: number;
  @IsOptionalNonNull() @IsUUID() cursor?: string;
}

export class CommentListQueryDto {
  @IsOptionalNonNull() @IsIn(['top', 'newest', 'oldest']) sort?: 'top' | 'newest' | 'oldest';
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) cursor?: number;
}

export class ReplyListQueryDto {
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) cursor?: number;
}

export class PostImageDto {
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

export class CreatePostDto {
  @IsOptionalNonNull() @IsString() @MaxLength(1000) text?: string;
  @IsOptionalNonNull() @IsEnum(PostVisibility) visibility?: PostVisibility;
  @IsOptionalNonNull() @IsEnum(PostVisibility) privacy?: PostVisibility;
  @IsOptionalNonNull() @IsUUID() profileOwnerId?: string;
  @IsOptionalNonNull() @IsUUID() targetUserId?: string;
  @IsOptionalNonNull() @IsUUID() profileUserId?: string;
  @IsOptionalNonNull() @IsUUID() activityId?: string;
  @IsOptionalNonNull() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptionalNonNull() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptionalNonNull() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PostImageDto) images?: PostImageDto[];
  @IsOptionalNonNull() @IsArray() @IsString({ each: true }) hashtags?: string[];
  @IsOptionalNonNull() @Transform(normalizeTaggedUsers) @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) taggedUserIds?: string[];
  @IsOptionalNonNull() @Transform(normalizeTaggedUsers) @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) taggedUsers?: string[];
}

export class CommentDto {
  @IsOptionalNonNull() @IsString() @MaxLength(500) body?: string;
  @IsOptionalNonNull() @IsUUID() parentId?: string;
  @IsOptionalNonNull() @IsArray() @ArrayMaxSize(1) @ValidateNested({ each: true }) @Type(() => PostImageDto) images?: PostImageDto[];
}

export class ReportPostDto {
  @IsOptionalNonNull() @IsEnum(PostReportReason) reason?: PostReportReason;
  @IsOptionalNonNull() @IsEnum(ReportCategory) category?: ReportCategory;
  @IsOptionalNonNull() @IsString() @MaxLength(1000) note?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(1000) details?: string;
}

export class UpdatePostDto {
  @IsOptionalNonNull() @IsString() @MaxLength(1000) text?: string;
  @IsOptionalNonNull() @IsEnum(PostVisibility) visibility?: PostVisibility;
  @IsOptionalNonNull() @IsEnum(PostVisibility) privacy?: PostVisibility;
  @IsOptionalNonNull() @IsUUID() activityId?: string;
  @IsOptionalNonNull() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PostImageDto) images?: PostImageDto[];
  @IsOptionalNonNull() @Transform(normalizeTaggedUsers) @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) taggedUserIds?: string[];
  @IsOptionalNonNull() @Transform(normalizeTaggedUsers) @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) taggedUsers?: string[];
}
export class UpdateCommentDto { @IsString() @MaxLength(500) body!: string; }
export class RepostDto { @IsOptionalNonNull() @IsString() @MaxLength(500) text?: string; }
