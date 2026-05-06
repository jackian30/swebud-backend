import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendDirectMessageDto {
  @IsUUID() recipientId!: string;
  @IsString() @MaxLength(4000) body!: string;
  @IsOptional() @IsString() @MaxLength(12000) ciphertext?: string;
  @IsOptional() @IsString() @MaxLength(512) nonce?: string;
  @IsOptional() @IsBoolean() encrypted?: boolean;
}

export class RegisterChatKeyDto { @IsString() @MaxLength(4096) publicKey!: string; }
export class MessageReactionDto { @IsString() @MaxLength(32) emoji!: string; }
export class TypingDto { @IsUUID() recipientId!: string; }
export class UpdateChatProfileDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(12000) profileImageUrl?: string;
}
