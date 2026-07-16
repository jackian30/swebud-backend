import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { FeedHashtagQueryDto, FeedQueryDto, FeedViewedDto } from './dto';

describe('Feed request DTOs', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const queryMetadata = { type: 'query' as const, metatype: FeedQueryDto, data: '' };
  const hashtagMetadata = { type: 'query' as const, metatype: FeedHashtagQueryDto, data: '' };
  const bodyMetadata = { type: 'body' as const, metatype: FeedViewedDto, data: '' };
  const postId = '8b22395d-7ef9-45cb-ad49-e4afee2f9f63';

  it('transforms the supported feed query without changing tab semantics', async () => {
    await expect(pipe.transform({
      take: '50',
      cursor: '0',
      hashtag: 'run,buddysession',
      sort: 'trending',
      followingOnly: 'false',
      tab: 'saved',
      timezone: 'Asia/Manila',
    }, queryMetadata)).resolves.toEqual({
      take: 50,
      cursor: 0,
      hashtag: 'run,buddysession',
      sort: 'trending',
      followingOnly: 'false',
      tab: 'saved',
      timezone: 'Asia/Manila',
    });
  });

  it.each([
    { take: '0' },
    { take: '51' },
    { take: '2.5' },
    { cursor: '-1' },
    { cursor: 'not-a-number' },
    { sort: 'popular' },
    { followingOnly: 'yes' },
    { tab: 'mine' },
    { timezone: 'not/a-real-timezone' },
    { hashtag: 'x'.repeat(501) },
  ])('rejects an invalid feed query %#', async (query) => {
    await expect(pipe.transform(query, queryMetadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a UUID-only viewed-post array while preserving the empty no-op', async () => {
    await expect(pipe.transform({ postIds: [] }, bodyMetadata)).resolves.toEqual({ postIds: [] });
    await expect(pipe.transform({ postIds: [postId] }, bodyMetadata)).resolves.toEqual({ postIds: [postId] });
    await expect(pipe.transform({}, bodyMetadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ postIds: ['not-a-uuid'] }, bodyMetadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ postIds: Array.from({ length: 101 }, () => postId) }, bodyMetadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes a bounded hashtag-search query', async () => {
    await expect(pipe.transform({ q: '  strength  ' }, hashtagMetadata)).resolves.toEqual({ q: 'strength' });
    await expect(pipe.transform({}, hashtagMetadata)).resolves.toEqual({});
    await expect(pipe.transform({ q: 'x'.repeat(121) }, hashtagMetadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ q: ['strength'] }, hashtagMetadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});
