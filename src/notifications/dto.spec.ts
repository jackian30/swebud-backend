import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { BuddyRoomTypingDto } from './dto';

describe('BuddyRoomTypingDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: BuddyRoomTypingDto, data: '' };
  const roomId = '8b22395d-7ef9-45cb-ad49-e4afee2f9f63';

  it('accepts only a UUID room id', async () => {
    await expect(pipe.transform({ roomId }, metadata)).resolves.toEqual({ roomId });
    await expect(pipe.transform({ roomId: 'not-a-uuid' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ roomId: null }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ roomId, unexpected: true }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});
