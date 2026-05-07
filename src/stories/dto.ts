import { PostVisibility } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStoryDto {
  @IsOptional() @IsString() @MaxLength(500) text?: string;
  @IsOptional() @IsIn(['caption', 'overlay']) textPlacement?: 'caption' | 'overlay';
  @IsOptional() @IsString() mediaUrl?: string;
  @IsOptional() @IsString() mediaType?: 'image' | 'video';
  @IsOptional() @IsString() mimeType?: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() @IsEnum(PostVisibility) visibility?: PostVisibility;
}

export class ReactStoryDto {
  @IsString() @IsIn(['🔥', '💪', '👏', '😍', '😂', '😮']) emoji!: string;
}

export class ReplyStoryDto {
  @IsString() @MaxLength(1000) body!: string;
}
