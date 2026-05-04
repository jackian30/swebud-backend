import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() displayName?: string;
}
export class LoginDto {
  @IsString() email!: string;
  @IsString() @MinLength(8) password!: string;
}
export class RefreshDto { @IsString() refreshToken!: string; }
export class LogoutDto { @IsOptional() @IsString() refreshToken?: string; }
export class ForgotPasswordDto { @IsEmail() email!: string; }
export class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(8) password!: string;
}
