import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateActivityDto, UpdateActivityDto } from './dto';

describe('activity body UUID validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const transform = (metatype: new () => unknown, value: unknown) => pipe.transform(value, { type: 'body', metatype, data: '' });
  const validActivity = { type: 'run', startedAt: '2026-07-16T08:00:00.000Z' };

  it.each([CreateActivityDto, UpdateActivityDto])('accepts a valid integrationId for %p', async (metatype) => {
    await expect(transform(metatype, {
      ...validActivity,
      integrationId: '8b22395d-7ef9-45cb-ad49-e4afee2f9f63',
    })).resolves.toMatchObject({ integrationId: '8b22395d-7ef9-45cb-ad49-e4afee2f9f63' });
  });

  it.each([CreateActivityDto, UpdateActivityDto])('rejects a malformed integrationId for %p', async (metatype) => {
    await expect(transform(metatype, {
      ...validActivity,
      integrationId: 'not-a-uuid',
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
