import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ChatMessageSearchQueryDto, ChatMuteDto, MessageReactionQueryDto, SendDirectMessageDto, TypingDto } from './dto';

describe('ChatMessageSearchQueryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'query' as const, metatype: ChatMessageSearchQueryDto, data: '' };

  it('normalizes a bounded message search term', async () => {
    await expect(pipe.transform({ q: '  strength plan  ' }, metadata)).resolves.toEqual({ q: 'strength plan' });
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('rejects oversized and non-string search terms', async () => {
    await expect(pipe.transform({ q: 'x'.repeat(121) }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ q: ['strength'] }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SendDirectMessageDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: SendDirectMessageDto, data: '' };
  const valid = {
    recipientId: '8b22395d-7ef9-45cb-ad49-e4afee2f9f63',
    body: 'Plaintext beta message',
  };

  it('accepts plaintext sends and the explicit false compatibility marker', async () => {
    await expect(pipe.transform(valid, metadata)).resolves.toEqual(valid);
    await expect(pipe.transform({ ...valid, encrypted: false }, metadata)).resolves.toEqual({ ...valid, encrypted: false });
  });

  it('rejects encrypted sends at DTO validation', async () => {
    await expect(pipe.transform({ ...valid, encrypted: true }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed recipient ids and unknown websocket payload fields', async () => {
    await expect(pipe.transform({ ...valid, recipientId: 'not-a-uuid' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...valid, unexpected: true }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['ciphertext', 'nonce'])('rejects the retired %s request field', async (field) => {
    await expect(pipe.transform({ ...valid, [field]: 'legacy-value' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TypingDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: TypingDto, data: '' };
  const recipientId = '8b22395d-7ef9-45cb-ad49-e4afee2f9f63';

  it('accepts only a UUID recipient id', async () => {
    await expect(pipe.transform({ recipientId }, metadata)).resolves.toEqual({ recipientId });
    await expect(pipe.transform({ recipientId: 'not-a-uuid' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ recipientId: null }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ recipientId, unexpected: true }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MessageReactionQueryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'query' as const, metatype: MessageReactionQueryDto, data: '' };

  it('requires one non-empty reaction query value no longer than 32 characters', async () => {
    await expect(pipe.transform({ emoji: '👍' }, metadata)).resolves.toEqual({ emoji: '👍' });
    await expect(pipe.transform({}, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ emoji: '' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ emoji: 'x'.repeat(33) }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChatMuteDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: ChatMuteDto, data: '' };

  it('accepts the explicit null sent by clients when unmuting', async () => {
    await expect(pipe.transform({ muted: false, mutedUntil: null }, metadata)).resolves.toEqual({ muted: false, mutedUntil: null });
  });
});
