import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsNumber, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { BuddyDiscoveryAudience, BuddyRoomParticipantRole, BuddySessionMessageKind, BuddySessionScope, BuddySessionVisibility, PostVisibility } from '@prisma/client';
import { IsOptionalNonNull, IsOptionalOrNull } from '../common/validation';

export class UpsertBuddySessionDto {
  @IsOptionalOrNull() @IsString() @MaxLength(60) activity?: string | null;
  @IsOptionalNonNull() @IsString() @MaxLength(60) subActivity?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(120) note?: string;
  @IsOptionalNonNull() @IsEnum(BuddyDiscoveryAudience) visibleTo?: BuddyDiscoveryAudience;
  @IsOptionalNonNull() @IsEnum(BuddyDiscoveryAudience) canSee?: BuddyDiscoveryAudience;
  @IsOptionalOrNull() @IsUUID() roomId?: string | null;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptionalNonNull() @IsNumber() @Min(5) @Max(120) ttlMinutes?: number;
}

export class NearbyBuddyQueryDto {
  @IsOptionalNonNull() @IsString() @MaxLength(60) activity?: string;
  @IsOptionalNonNull() @IsUUID() roomId?: string;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptionalNonNull() @Type(() => Number) @IsNumber() @Min(0.1) @Max(100) radiusKm?: number;
  @IsOptionalNonNull() @Type(() => Number) @IsNumber() @Min(1) @Max(100) take?: number;
}

export class DiscoverableBuddyQueryDto {
  @IsOptionalNonNull() @IsString() @MaxLength(60) activity?: string;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @Type(() => Number) @IsNumber() @Min(0.1) @Max(100) radiusKm!: number;
  @IsOptionalNonNull() @Type(() => Number) @IsNumber() @Min(1) @Max(500) take?: number;
}

export class CreateBuddyRoomDto {
  @IsOptionalNonNull() @IsString() @MaxLength(80) name?: string;
  @IsOptionalNonNull() @IsEnum(BuddySessionScope) scope?: BuddySessionScope;
  @IsOptionalNonNull() @IsEnum(BuddySessionVisibility) visibility?: BuddySessionVisibility;
  @IsOptionalNonNull() @IsUUID() groupId?: string;
  @IsOptionalOrNull() @IsString() @MaxLength(60) activity?: string | null;
  @IsOptionalNonNull() @IsString() @MaxLength(60) subActivity?: string;
  @IsOptionalNonNull() @IsNumber() @Min(15) @Max(360) ttlMinutes?: number;
}

export class UpdateBuddyRoomDto {
  @IsOptionalOrNull() @IsString() @MaxLength(60) activity?: string | null;
  @IsOptionalOrNull() @IsString() @MaxLength(60) subActivity?: string | null;
}

export class BuddyRoomQueryDto {
  @IsOptionalNonNull() @IsEnum(BuddySessionScope) scope?: BuddySessionScope;
  @IsOptionalNonNull() @IsUUID() groupId?: string;
}

export class BuddySessionRecapQueryDto {
  @IsOptionalNonNull() @IsUUID() groupId?: string;
}

export class BuddyInviteCandidatesQueryDto {
  @IsOptionalNonNull()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class JoinBuddyRoomDto {
  @IsOptionalNonNull() @IsUUID() roomId?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(24) code?: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
}

export class PinBuddyRoomLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptionalNonNull() @IsString() @MaxLength(80) label?: string;
}

export class PinBuddyRoomPersonalLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptionalNonNull() @IsString() @MaxLength(80) label?: string;
}

export class InviteBuddyRoomDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) recipientIds!: string[];
  @IsOptionalNonNull() @IsString() @MaxLength(1000) inviteUrl?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(500) message?: string;
}

export class SendBuddySessionMessageDto {
  @IsOptionalNonNull() @IsIn([BuddySessionMessageKind.text, BuddySessionMessageKind.gif]) kind?: 'text' | 'gif';
  @IsString() @MaxLength(1000) body!: string;
  @IsOptionalNonNull() @IsIn(['message']) referenceType?: 'message';
  @IsOptionalNonNull() @IsString() @MaxLength(120) referenceId?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(500) referenceText?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(120) referenceAuthorName?: string;
}

export class BuddySessionMessageReactionDto {
  @IsString() @MaxLength(32) emoji!: string;
}

export class BuddySessionMessageReactionQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(32) emoji!: string;
}

export class KickBuddyRoomParticipantDto {
  @IsOptionalNonNull() @IsString() @MaxLength(240) reason?: string;
}

export class UpdateBuddyRoomParticipantRoleDto {
  @IsIn([BuddyRoomParticipantRole.admin, BuddyRoomParticipantRole.member])
  role!: Exclude<BuddyRoomParticipantRole, 'owner'>;
}

export class UpdateBuddySessionRecapDto {
  @IsOptionalNonNull() @IsString() @MaxLength(100) title?: string;
  @IsOptionalOrNull() @IsString() @MaxLength(1000) caption?: string | null;
  @IsOptionalOrNull() @IsString() @MaxLength(120) areaLabel?: string | null;
  @IsOptionalNonNull() @IsBoolean() includeParticipants?: boolean;
  @IsOptionalNonNull() @IsBoolean() includeBroadArea?: boolean;
  @IsOptionalNonNull() @IsEnum(PostVisibility) visibility?: PostVisibility;
}

export class ShareBuddySessionRecapDto extends UpdateBuddySessionRecapDto {
  @IsOptionalNonNull() @IsIn(['feed', 'group']) target?: 'feed' | 'group';
}
