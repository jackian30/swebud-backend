import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

export class KlipySearchQueryDto {
  @IsOptionalNonNull() @IsString() @MaxLength(120) q?: string;
  @IsOptionalNonNull() @IsIn(['gifs', 'stickers']) type?: 'gifs' | 'stickers';
  @IsOptionalNonNull() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
