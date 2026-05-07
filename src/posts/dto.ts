import { Transform, Type } from 'class-transformer';
import { PostVisibility } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const normalizeTaggedUsers = ({ value }: { value: unknown }) => Array.isArray(value)
  ? value.map((item) => (typeof item === 'string' ? item : (item as { id?: unknown; userId?: unknown })?.id ?? (item as { userId?: unknown })?.userId)).filter(Boolean)
  : value;

export class PostImageDto {
  @IsString() url!: string;
  @IsOptional() @IsString() alt?: string;
  @IsOptional() @IsString() type?: 'image' | 'video';
  @IsOptional() @IsString() mediaType?: 'image' | 'video';
  @IsOptional() @IsString() mimeType?: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() @IsNumber() size?: number;
  @IsOptional() @IsNumber() width?: number;
  @IsOptional() @IsNumber() height?: number;
}

export class CreatePostDto {
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsEnum(PostVisibility) visibility?: PostVisibility;
  @IsOptional() @IsEnum(PostVisibility) privacy?: PostVisibility;
  @IsOptional() @IsString() profileOwnerId?: string;
  @IsOptional() @IsString() targetUserId?: string;
  @IsOptional() @IsString() profileUserId?: string;
  @IsOptional() @IsString() activityId?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PostImageDto) images?: PostImageDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) hashtags?: string[];
  @IsOptional() @Transform(normalizeTaggedUsers) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) taggedUserIds?: string[];
  @IsOptional() @Transform(normalizeTaggedUsers) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) taggedUsers?: string[];
}

export class CommentDto {
  @IsOptional() @IsString() @MaxLength(500) body?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(1) @ValidateNested({ each: true }) @Type(() => PostImageDto) images?: PostImageDto[];
}

export class ReportPostDto {
  @IsOptional() @IsString() reason?: 'spam' | 'harassment' | 'nudity' | 'violence' | 'other';
  @IsOptional() @IsString() note?: string;
}

export class UpdatePostDto {
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsEnum(PostVisibility) visibility?: PostVisibility;
  @IsOptional() @IsEnum(PostVisibility) privacy?: PostVisibility;
  @IsOptional() @IsString() activityId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PostImageDto) images?: PostImageDto[];
  @IsOptional() @Transform(normalizeTaggedUsers) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) taggedUserIds?: string[];
  @IsOptional() @Transform(normalizeTaggedUsers) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) taggedUsers?: string[];
}
export class UpdateCommentDto { @IsString() @MaxLength(500) body!: string; }
export class RepostDto { @IsOptional() @IsString() @MaxLength(500) text?: string; }
