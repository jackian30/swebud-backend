import { IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { IsArray, IsDate, IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class ConnectIntegrationDto {
  @IsEnum(IntegrationProvider) provider!: IntegrationProvider;
  @IsOptional() @IsString() providerUserId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) scopes?: string[];
  @IsOptional() @Type(() => Date) @IsDate() tokenExpiresAt?: Date;
}

export class UpdateIntegrationDto {
  @IsOptional() @IsEnum(IntegrationStatus) status?: IntegrationStatus;
  @IsOptional() @IsString() lastSyncError?: string;
  @IsOptional() @Type(() => Date) @IsDate() lastSyncAt?: Date;
}
