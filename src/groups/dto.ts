import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

export class CreateGroupDto {
  @IsString() name!: string;
  @IsString() @Matches(/^[a-z0-9-]{3,60}$/) slug!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(['public', 'private']) visibility?: 'public' | 'private';
}

export class UpdateGroupSettingsDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() profileImageUrl?: string;
  @IsOptional() @IsIn(['public', 'private']) visibility?: 'public' | 'private';
  @IsOptional() @IsBoolean() allowAnonymousPosts?: boolean;
}

export class UpdateGroupRoleDto { @IsIn(['owner', 'admin', 'moderator', 'member']) role!: 'owner' | 'admin' | 'moderator' | 'member'; }

export class GroupPostImageDto {
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

export class GroupPostDto {
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsBoolean() anonymous?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => GroupPostImageDto) images?: GroupPostImageDto[];
}

export class GroupMessageDto { @IsString() @MaxLength(1000) body!: string; }

export class CreateGroupChannelDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9 -]{1,38}[a-z0-9]$/i) name!: string;
  @IsOptional() @IsString() @MaxLength(160) description?: string;
  @IsOptional() @IsIn(['public', 'private']) visibility?: 'public' | 'private';
  @IsOptional() @IsIn(['everyone', 'admins']) messagePolicy?: 'everyone' | 'admins';
  @IsOptional() @IsArray() @IsString({ each: true }) memberIds?: string[];
}
