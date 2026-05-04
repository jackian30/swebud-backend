import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateMeDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() bio?: string;
  @IsOptional() @IsString() profileImageUrl?: string;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
}
