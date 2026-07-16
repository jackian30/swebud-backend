import { ActivitySource } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsObject, IsString, IsUUID, Max, Min } from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

export enum ActivityStatsWindow {
  week = 'week',
  month = 'month',
  year = 'year',
  all = 'all',
}

export class ActivityListQueryDto {
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}

export class ActivityStatsQueryDto {
  @IsOptionalNonNull() @IsEnum(ActivityStatsWindow) window?: ActivityStatsWindow;
}

export class CreateActivityDto {
  @IsOptionalNonNull() @IsUUID() integrationId?: string;
  @IsOptionalNonNull() @IsEnum(ActivitySource) source?: ActivitySource;
  @IsOptionalNonNull() @IsString() externalId?: string;
  @IsString() type!: string;
  @IsOptionalNonNull() @IsString() title?: string;
  @Type(() => Date) @IsDate() startedAt!: Date;
  @IsOptionalNonNull() @IsInt() @Min(0) durationSeconds?: number;
  @IsOptionalNonNull() @IsNumber() @Min(0) distanceMeters?: number;
  @IsOptionalNonNull() @IsNumber() @Min(0) elevationGainMeters?: number;
  @IsOptionalNonNull() @IsInt() @Min(0) calories?: number;
  @IsOptionalNonNull() @IsInt() @Min(0) averageHeartRate?: number;
  @IsOptionalNonNull() @IsInt() @Min(0) maxHeartRate?: number;
  @IsOptionalNonNull() @IsInt() @Min(0) averagePaceSecondsKm?: number;
  @IsOptionalNonNull() @IsNumber() @Min(0) averageSpeedMetersSec?: number;
  @IsOptionalNonNull() @IsObject() raw?: Record<string, unknown>;
}

export class UpdateActivityDto extends CreateActivityDto {}
