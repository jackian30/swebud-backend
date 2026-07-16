import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, IsTimeZone, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

export class FeedViewedDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) postIds!: string[];
}

export class FeedHashtagQueryDto {
  @IsOptionalNonNull()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class FeedQueryDto {
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) take?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(0) cursor?: number;
  @IsOptionalNonNull() @IsString() @MaxLength(500) hashtag?: string;
  @IsOptionalNonNull() @IsIn(['relevance', 'latest', 'trending', 'unseen', 'time']) sort?: 'relevance' | 'latest' | 'trending' | 'unseen' | 'time';
  @IsOptionalNonNull() @IsIn(['true', 'false']) followingOnly?: 'true' | 'false';
  @IsOptionalNonNull() @IsIn(['for-you', 'following', 'saved']) tab?: 'for-you' | 'following' | 'saved';
  @IsOptionalNonNull() @IsString() @MaxLength(100) @IsTimeZone() timezone?: string;
}
