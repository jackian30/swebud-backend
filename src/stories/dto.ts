import { Transform } from 'class-transformer';
import { PostVisibility } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

const normalizeUserIds = ({ value }: { value: unknown }) => {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .flatMap((item) => typeof item === 'string' ? item.split(',') : [item])
    .map((item) => typeof item === 'string' ? item.trim() : item)
    .filter((item) => item !== ''))];
};

export class ActiveStoryAuthorsQueryDto {
  @IsOptionalNonNull()
  @Transform(normalizeUserIds)
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  userIds?: string[];
}

export class CreateStoryDto {
  @IsOptionalNonNull() @IsString() @MaxLength(500) text?: string;
  @IsOptionalNonNull() @IsIn(['caption', 'overlay']) textPlacement?: 'caption' | 'overlay';
  @IsOptionalNonNull() @IsString() mediaUrl?: string;
  @IsOptionalNonNull() @IsString() @IsIn(['image', 'video']) mediaType?: 'image' | 'video';
  @IsOptionalNonNull() @IsString() mimeType?: string;
  @IsOptionalNonNull() @IsString() filename?: string;
  @IsOptionalNonNull() @IsEnum(PostVisibility) visibility?: PostVisibility;
}

export class ReactStoryDto {
  @IsString() @IsIn(['🔥', '💪', '👏', '😍', '😂', '😮']) emoji!: string;
}

export class ReplyStoryDto {
  @IsString() @MaxLength(1000) body!: string;
}
