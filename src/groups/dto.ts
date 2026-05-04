import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateGroupDto {
  @IsString() name!: string;
  @IsString() @Matches(/^[a-z0-9-]{3,60}$/) slug!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(['public', 'private']) visibility?: 'public' | 'private';
}

export class GroupPostDto { @IsString() @MaxLength(1000) text!: string; }

export class GroupMessageDto { @IsString() @MaxLength(1000) body!: string; }
