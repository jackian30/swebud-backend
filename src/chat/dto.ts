import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SendDirectMessageDto {
  @IsString() recipientId!: string;
  @IsString() body!: string;
  @IsOptional() @IsString() ciphertext?: string;
  @IsOptional() @IsString() nonce?: string;
  @IsOptional() @IsBoolean() encrypted?: boolean;
}

export class RegisterChatKeyDto { @IsString() publicKey!: string; }
export class MessageReactionDto { @IsString() emoji!: string; }
export class TypingDto { @IsString() recipientId!: string; }
