import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { KlipySearchQueryDto } from './dto';

describe('KlipySearchQueryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'query' as const, metatype: KlipySearchQueryDto, data: '' };

  it('validates and transforms the supported search query', async () => {
    await expect(pipe.transform({ q: 'run', type: 'stickers', limit: '50' }, metadata)).resolves.toEqual({
      q: 'run',
      type: 'stickers',
      limit: 50,
    });
  });

  it.each([
    { q: 'x'.repeat(121) },
    { type: 'videos' },
    { limit: '0' },
    { limit: '51' },
    { limit: '2.5' },
    { limit: 'not-a-number' },
  ])('rejects an invalid query %#', async (query) => {
    await expect(pipe.transform(query, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});
