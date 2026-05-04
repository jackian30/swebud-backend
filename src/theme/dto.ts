import { IsEnum } from 'class-validator';

export enum ThemeDtoPreference { system = 'system', light = 'light', dark = 'dark' }

export class UpdateThemeDto {
  @IsEnum(ThemeDtoPreference) theme!: ThemeDtoPreference;
}
