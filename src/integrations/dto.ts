import { IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { IsArray, IsDate, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { IsOptionalNonNull } from '../common/validation';

export class ConnectIntegrationDto {
  @IsEnum(IntegrationProvider) provider!: IntegrationProvider;
  @IsOptionalNonNull() @IsString() providerUserId?: string;
  @IsOptionalNonNull() @IsArray() @IsString({ each: true }) scopes?: string[];
  @IsOptionalNonNull() @Type(() => Date) @IsDate() tokenExpiresAt?: Date;
}

export class UpdateIntegrationDto {
  @IsOptionalNonNull() @IsEnum(IntegrationStatus) status?: IntegrationStatus;
  @IsOptionalNonNull() @IsString() lastSyncError?: string;
  @IsOptionalNonNull() @Type(() => Date) @IsDate() lastSyncAt?: Date;
}
