import { IsUUID } from 'class-validator';

export class BuddyRoomTypingDto {
  @IsUUID() roomId!: string;
}
