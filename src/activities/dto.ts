import { ActivitySource } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateActivityDto {
  @IsOptional() @IsString() integrationId?: string;
  @IsOptional() @IsEnum(ActivitySource) source?: ActivitySource;
  @IsOptional() @IsString() externalId?: string;
  @IsString() type!: string;
  @IsOptional() @IsString() title?: string;
  @Type(() => Date) @IsDate() startedAt!: Date;
  @IsOptional() @IsInt() @Min(0) durationSeconds?: number;
  @IsOptional() @IsNumber() @Min(0) distanceMeters?: number;
  @IsOptional() @IsNumber() @Min(0) elevationGainMeters?: number;
  @IsOptional() @IsInt() @Min(0) calories?: number;
  @IsOptional() @IsInt() @Min(0) averageHeartRate?: number;
  @IsOptional() @IsInt() @Min(0) maxHeartRate?: number;
  @IsOptional() @IsInt() @Min(0) averagePaceSecondsKm?: number;
  @IsOptional() @IsNumber() @Min(0) averageSpeedMetersSec?: number;
  @IsOptional() @IsObject() raw?: Record<string, unknown>;
}

export class UpdateActivityDto extends CreateActivityDto {}
