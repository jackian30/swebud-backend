import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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

export class GroupPostDto { @IsString() @MaxLength(1000) text!: string; @IsOptional() @IsBoolean() anonymous?: boolean; }

export class GroupMessageDto { @IsString() @MaxLength(1000) body!: string; }

export class CreateGroupChannelDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9 -]{1,38}[a-z0-9]$/i) name!: string;
  @IsOptional() @IsString() @MaxLength(160) description?: string;
  @IsOptional() @IsIn(['public', 'private']) visibility?: 'public' | 'private';
  @IsOptional() @IsIn(['everyone', 'admins']) messagePolicy?: 'everyone' | 'admins';
  @IsOptional() @IsArray() @IsString({ each: true }) memberIds?: string[];
}
