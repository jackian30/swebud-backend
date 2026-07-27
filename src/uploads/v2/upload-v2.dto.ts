import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { mediaCollections } from '../media-library/collections';

const collections = Object.keys(mediaCollections);
const BASE64_SHA256 = '^[A-Za-z0-9+/]{43}=$';

export class CreateUploadSessionDto {
  @IsString()
  @IsIn(collections)
  collection: keyof typeof mediaCollections;

  @IsString()
  @MaxLength(127)
  mimeType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  size: number;

  @IsOptional()
  @IsString()
  @Matches(new RegExp(BASE64_SHA256))
  sha256?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
  idempotencyKey?: string;
}

export class UploadPartIntentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  partNumber: number;

  @IsString()
  @Matches(new RegExp(BASE64_SHA256))
  checksumSha256: string;
}

export class MintUploadPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UploadPartIntentDto)
  parts: UploadPartIntentDto[];
}

export class CompletedUploadPartDto extends UploadPartIntentDto {
  @IsString()
  @MaxLength(256)
  @Matches(/^[\x21-\x7E]+$/)
  etag: string;
}

export class CompleteUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => CompletedUploadPartDto)
  parts: CompletedUploadPartDto[];
}
