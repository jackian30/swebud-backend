import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class PostImageDto {
  @IsString() url!: string;
  @IsOptional() @IsString() alt?: string;
}

export class CreatePostDto {
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PostImageDto) images?: PostImageDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) hashtags?: string[];
}

export class CommentDto {
  @IsString() @MaxLength(500) body!: string;
  @IsOptional() @IsString() parentId?: string;
}

export class ReportPostDto {
  @IsOptional() @IsString() reason?: 'spam' | 'harassment' | 'nudity' | 'violence' | 'other';
  @IsOptional() @IsString() note?: string;
}

export class UpdatePostDto { @IsOptional() @IsString() @MaxLength(1000) text?: string; }
export class UpdateCommentDto { @IsString() @MaxLength(500) body!: string; }
export class RepostDto { @IsOptional() @IsString() @MaxLength(500) text?: string; }
