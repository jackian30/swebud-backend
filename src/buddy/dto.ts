import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BuddyActivity } from '@prisma/client';

export class UpsertBuddySessionDto {
  @IsOptional() @IsEnum(BuddyActivity) activity?: BuddyActivity;
  @IsOptional() @IsString() @MaxLength(60) subActivity?: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsNumber() @Min(5) @Max(120) ttlMinutes?: number;
}

export class NearbyBuddyQueryDto {
  @IsOptional() @IsEnum(BuddyActivity) activity?: BuddyActivity;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) radiusKm?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) take?: number;
}
