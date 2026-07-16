import { ReportCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { IsOptionalNonNull, IsOptionalOrNull } from '../common/validation';

export class ChatHistoryQueryDto {
  @IsOptionalNonNull() @IsUUID() cursor?: string;
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ChatMessageSearchQueryDto {
  @IsOptionalNonNull()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class SendDirectMessageDto {
  @IsUUID() recipientId!: string;
  @IsString() @MaxLength(4000) body!: string;
  @IsOptionalNonNull() @IsIn([false]) encrypted?: false;
  @IsOptionalNonNull() @IsIn(['actsnap', 'message']) referenceType?: 'actsnap' | 'message';
  @IsOptionalNonNull() @IsString() @MaxLength(120) referenceId?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(12000) referenceMediaUrl?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(500) referenceText?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(120) referenceAuthorName?: string;
}

export class RegisterChatKeyDto {
  @IsString() @MaxLength(4096) publicKey!: string;
}
export class MessageReactionDto { @IsString() @MaxLength(32) emoji!: string; }
export class MessageReactionQueryDto { @IsString() @IsNotEmpty() @MaxLength(32) emoji!: string; }
export class ChatMuteDto { @IsBoolean() muted!: boolean; @IsOptionalOrNull() @IsDateString() mutedUntil?: string | null; }
export class ChatPinDto { @IsBoolean() pinned!: boolean; }
export class ReportMessageDto {
  @IsOptionalNonNull() @IsEnum(ReportCategory) category?: ReportCategory;
  @IsOptionalNonNull() @IsString() @MaxLength(1000) note?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(1000) details?: string;
}
export class TypingDto { @IsUUID() recipientId!: string; }
export class UpdateChatProfileDto {
  @IsOptionalNonNull() @IsString() @MaxLength(120) displayName?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(12000) profileImageUrl?: string;
}

export class CreateBuddyGroupChatDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptionalNonNull() @IsString() @MaxLength(240) description?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) participantIds!: string[];
}

export class AddBuddyGroupParticipantsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) participantIds!: string[];
}

export class SendBuddyGroupMessageDto {
  @IsString() @MaxLength(4000) body!: string;
  @IsOptionalNonNull() @IsIn(['message']) referenceType?: 'message';
  @IsOptionalNonNull() @IsString() @MaxLength(120) referenceId?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(500) referenceText?: string;
  @IsOptionalNonNull() @IsString() @MaxLength(120) referenceAuthorName?: string;
}
