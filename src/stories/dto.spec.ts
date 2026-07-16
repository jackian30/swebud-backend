import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ActiveStoryAuthorsQueryDto, CreateStoryDto } from './dto';

describe('ActiveStoryAuthorsQueryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'query' as const, metatype: ActiveStoryAuthorsQueryDto, data: '' };
  const firstId = '8b22395d-7ef9-45cb-ad49-e4afee2f9f63';
  const secondId = '31ccca0a-ed69-4aca-94e8-556d658e88ec';

  it('normalizes repeated and comma-separated user ids', async () => {
    await expect(pipe.transform({ userIds: [` ${firstId},${secondId} `, firstId, ''] }, metadata)).resolves.toEqual({
      userIds: [firstId, secondId],
    });
  });

  it('allows the query to be omitted', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('rejects malformed ids and unbounded author lists', async () => {
    await expect(pipe.transform({ userIds: 'not-a-uuid' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    const tooManyIds = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`);
    await expect(pipe.transform({ userIds: tooManyIds }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreateStoryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: CreateStoryDto, data: '' };

  it.each(['image', 'video'])('accepts %s media', async (mediaType) => {
    await expect(pipe.transform({ mediaUrl: '/uploads/media', mediaType }, metadata)).resolves.toEqual({
      mediaUrl: '/uploads/media',
      mediaType,
    });
  });

  it('rejects unsupported media types', async () => {
    await expect(pipe.transform({ mediaUrl: '/uploads/media', mediaType: 'audio' }, metadata))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['text', 'textPlacement', 'mediaUrl', 'mediaType', 'mimeType', 'filename', 'visibility'])(
    'rejects explicit null for the optional non-null field %s',
    async (field) => {
      await expect(pipe.transform({ [field]: null }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
