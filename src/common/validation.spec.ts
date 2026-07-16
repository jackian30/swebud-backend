import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { IsString } from 'class-validator';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { IsOptionalNonNull, IsOptionalOrNull } from './validation';

class OptionalValueDto {
  @IsOptionalNonNull() @IsString() strict?: string;
  @IsOptionalOrNull() @IsString() clearable?: string | null;
}

describe('optional request validation policy', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: OptionalValueDto, data: '' };

  it('allows omission without treating explicit null as omission', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
    await expect(pipe.transform({ strict: null }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows null only for an explicitly clearable field', async () => {
    await expect(pipe.transform({ clearable: null }, metadata)).resolves.toEqual({ clearable: null });
  });

  it('requires every DTO to declare its null policy explicitly', () => {
    const dtoFiles = filesBelow(join(process.cwd(), 'src')).filter((path) => path.endsWith('/dto.ts'));
    for (const path of dtoFiles) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/@IsOptional\(\)/);
    }
  });
});

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}
