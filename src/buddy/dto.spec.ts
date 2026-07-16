import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { BuddyInviteCandidatesQueryDto, BuddySessionMessageReactionQueryDto, CreateBuddyRoomDto, SendBuddySessionMessageDto, UpsertBuddySessionDto } from './dto';

describe('BuddyInviteCandidatesQueryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'query' as const, metatype: BuddyInviteCandidatesQueryDto, data: '' };

  it('normalizes a bounded invite search term', async () => {
    await expect(pipe.transform({ q: '  Alice  ' }, metadata)).resolves.toEqual({ q: 'Alice' });
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('rejects oversized and non-string search terms', async () => {
    await expect(pipe.transform({ q: 'x'.repeat(121) }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ q: ['Alice'] }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SendBuddySessionMessageDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: SendBuddySessionMessageDto, data: '' };

  it.each(['text', 'gif'])('accepts user-sendable %s messages', async (kind) => {
    await expect(pipe.transform({ kind, body: 'hello' }, metadata)).resolves.toEqual({ kind, body: 'hello' });
  });

  it.each(['sticker', 'joined', 'left', 'kicked'])('rejects server-only or legacy %s sends', async (kind) => {
    await expect(pipe.transform({ kind, body: 'hello' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BuddySessionMessageReactionQueryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'query' as const, metatype: BuddySessionMessageReactionQueryDto, data: '' };

  it('requires one non-empty reaction query value no longer than 32 characters', async () => {
    await expect(pipe.transform({ emoji: '🔥' }, metadata)).resolves.toEqual({ emoji: '🔥' });
    await expect(pipe.transform({}, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ emoji: '' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ emoji: 'x'.repeat(33) }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('nullable Buddy session request compatibility', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  it('accepts the normal blank Find Buddy session payload', async () => {
    await expect(pipe.transform({
      activity: null,
      roomId: null,
      latitude: 14.2137,
      longitude: 121.1668,
    }, { type: 'body', metatype: UpsertBuddySessionDto, data: '' })).resolves.toEqual({
      activity: null,
      roomId: null,
      latitude: 14.2137,
      longitude: 121.1668,
    });
  });

  it('accepts a room without a selected activity', async () => {
    await expect(pipe.transform({ activity: null }, { type: 'body', metatype: CreateBuddyRoomDto, data: '' }))
      .resolves.toEqual({ activity: null });
  });
});
