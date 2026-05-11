import { PostVisibility, GroupVisibility } from '@prisma/client';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminListQueryDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() take?: string;
  @IsOptional() @IsString() skip?: string;
}

export class AdminUpdateUserDto {
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(32) username?: string;
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) roleKeys?: string[];
}

export class AdminDatabaseQueryDto {
  @IsOptional() @IsString() take?: string;
  @IsOptional() @IsString() skip?: string;
  @IsOptional() @IsString() orderBy?: string;
  @IsOptional() @IsString() order?: 'asc' | 'desc';
}

export class AdminUpdateRecordDto {
  data!: Record<string, unknown>;
}

export class AdminUpdatePostDto {
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsEnum(PostVisibility) visibility?: PostVisibility;
  @IsOptional() @IsBoolean() pinned?: boolean;
}

export class AdminUpdateGroupDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() profileImageUrl?: string;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsEnum(GroupVisibility) visibility?: GroupVisibility;
  @IsOptional() @IsBoolean() allowAnonymousPosts?: boolean;
}
