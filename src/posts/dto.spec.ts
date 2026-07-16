import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CommentDto, CommentListQueryDto, CreatePostDto, PostListQueryDto, ReplyListQueryDto, UpdatePostDto } from './dto';

describe('post query DTOs', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const transform = (metatype: new () => unknown, value: unknown) => pipe.transform(value, { type: 'query', metatype, data: '' });
  const cursorId = '8b22395d-7ef9-45cb-ad49-e4afee2f9f63';

  it('coerces valid list, comment, and reply pagination', async () => {
    await expect(transform(PostListQueryDto, { take: '20', cursor: cursorId })).resolves.toEqual({ take: 20, cursor: cursorId });
    await expect(transform(CommentListQueryDto, { sort: 'newest', take: '50', cursor: '0' })).resolves.toEqual({ sort: 'newest', take: 50, cursor: 0 });
    await expect(transform(ReplyListQueryDto, { take: '1', cursor: '100000' })).resolves.toEqual({ take: 1, cursor: 100_000 });
  });

  it.each([
    [{ take: '0' }, PostListQueryDto],
    [{ take: '1.5' }, PostListQueryDto],
    [{ cursor: 'not-a-uuid' }, PostListQueryDto],
    [{ sort: 'popular' }, CommentListQueryDto],
    [{ take: '51' }, CommentListQueryDto],
    [{ cursor: '-1' }, ReplyListQueryDto],
    [{ cursor: '100001' }, ReplyListQueryDto],
  ] as const)('rejects malformed post pagination query %#', async (value, metatype) => {
    await expect(transform(metatype, value)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreatePostDto image metadata', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: CreatePostDto, data: '' };

  it.each(['type', 'mediaType'] as const)('accepts supported image %s values', async (field) => {
    await expect(pipe.transform({
      images: [{ url: '/uploads/posts/file.webp', [field]: 'image' }],
    }, metadata)).resolves.toEqual({
      images: [{ url: '/uploads/posts/file.webp', [field]: 'image' }],
    });
  });

  it.each(['type', 'mediaType'] as const)('rejects unsupported image %s values', async (field) => {
    await expect(pipe.transform({
      images: [{ url: '/uploads/posts/file.bin', [field]: 'binary' }],
    }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['text', 'visibility', 'images', 'hashtags', 'latitude', 'longitude', 'profileOwnerId', 'targetUserId', 'profileUserId', 'activityId', 'taggedUserIds', 'taggedUsers'])(
    'rejects explicit null for the optional non-null field %s',
    async (field) => {
      await expect(pipe.transform({ [field]: null }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});

describe('post body UUID validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const uuid = '8b22395d-7ef9-45cb-ad49-e4afee2f9f63';
  const secondUuid = '5bcff9c8-3959-4e13-9c1e-7ceaa55d42e2';
  const transform = (metatype: new () => unknown, value: unknown) => pipe.transform(value, { type: 'body', metatype, data: '' });

  it.each(['profileOwnerId', 'targetUserId', 'profileUserId', 'activityId'] as const)(
    'rejects malformed CreatePostDto %s values',
    async (field) => {
      await expect(transform(CreatePostDto, { [field]: 'not-a-uuid' })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([
    [CreatePostDto, 'taggedUserIds'],
    [CreatePostDto, 'taggedUsers'],
    [UpdatePostDto, 'taggedUserIds'],
    [UpdatePostDto, 'taggedUsers'],
  ] as const)('rejects malformed %p items on %s', async (metatype, field) => {
    await expect(transform(metatype, { [field]: [uuid, 'not-a-uuid'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves supported taggedUsers object aliases while validating their UUIDs', async () => {
    await expect(transform(CreatePostDto, {
      taggedUsers: [{ id: uuid }, { userId: secondUuid }],
    })).resolves.toEqual({ taggedUsers: [uuid, secondUuid] });
  });

  it('rejects malformed update activity and comment parent ids', async () => {
    await expect(transform(UpdatePostDto, { activityId: 'not-a-uuid' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(transform(CommentDto, { parentId: 'not-a-uuid' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
