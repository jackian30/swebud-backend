import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { BuddyActivity, BuddyDiscoveryAudience, BuddySessionScope, BuddySessionVisibility } from '@prisma/client';

export class UpsertBuddySessionDto {
  @IsOptional() @IsEnum(BuddyActivity) activity?: BuddyActivity;
  @IsOptional() @IsString() @MaxLength(60) subActivity?: string;
  @IsOptional() @IsString() @MaxLength(120) note?: string;
  @IsOptional() @IsEnum(BuddyDiscoveryAudience) visibleTo?: BuddyDiscoveryAudience;
  @IsOptional() @IsEnum(BuddyDiscoveryAudience) canSee?: BuddyDiscoveryAudience;
  @IsOptional() @IsUUID() roomId?: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsNumber() @Min(5) @Max(120) ttlMinutes?: number;
}

export class NearbyBuddyQueryDto {
  @IsOptional() @IsEnum(BuddyActivity) activity?: BuddyActivity;
  @IsOptional() @IsUUID() roomId?: string;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) radiusKm?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) take?: number;
}

export class CreateBuddyRoomDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsEnum(BuddySessionScope) scope?: BuddySessionScope;
  @IsOptional() @IsEnum(BuddySessionVisibility) visibility?: BuddySessionVisibility;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsEnum(BuddyActivity) activity?: BuddyActivity;
  @IsOptional() @IsString() @MaxLength(60) subActivity?: string;
  @IsOptional() @IsNumber() @Min(15) @Max(360) ttlMinutes?: number;
}

export class BuddyRoomQueryDto {
  @IsOptional() @IsEnum(BuddySessionScope) scope?: BuddySessionScope;
  @IsOptional() @IsUUID() groupId?: string;
}

export class JoinBuddyRoomDto {
  @IsOptional() @IsUUID() roomId?: string;
  @IsOptional() @IsString() @MaxLength(24) code?: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
}
