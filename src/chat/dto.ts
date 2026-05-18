import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendDirectMessageDto {
  @IsUUID() recipientId!: string;
  @IsString() @MaxLength(4000) body!: string;
  @IsOptional() @IsString() @MaxLength(12000) ciphertext?: string;
  @IsOptional() @IsString() @MaxLength(512) nonce?: string;
  @IsOptional() @IsBoolean() encrypted?: boolean;
  @IsOptional() @IsIn(['actsnap']) referenceType?: 'actsnap';
  @IsOptional() @IsString() @MaxLength(120) referenceId?: string;
  @IsOptional() @IsString() @MaxLength(12000) referenceMediaUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) referenceText?: string;
  @IsOptional() @IsString() @MaxLength(120) referenceAuthorName?: string;
}

export class RegisterChatKeyDto {
  @IsString() @MaxLength(4096) publicKey!: string;
  @IsOptional() @IsString() @MaxLength(4096) privateKey?: string;
}
export class MessageReactionDto { @IsString() @MaxLength(32) emoji!: string; }
export class TypingDto { @IsUUID() recipientId!: string; }
export class UpdateChatProfileDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(12000) profileImageUrl?: string;
}

export class CreateBuddyGroupChatDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) participantIds!: string[];
}

export class AddBuddyGroupParticipantsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) participantIds!: string[];
}

export class SendBuddyGroupMessageDto {
  @IsString() @MaxLength(4000) body!: string;
}
