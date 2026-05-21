import { IsEnum, IsOptional } from 'class-validator';

export enum ThemeDtoPreference { system = 'system', light = 'light', dark = 'dark' }
export enum MapVisualDtoPreference { system = 'system', streets = 'streets', light = 'light', dark = 'dark', satellite = 'satellite' }

export class UpdateThemeDto {
  @IsOptional()
  @IsEnum(ThemeDtoPreference)
  theme?: ThemeDtoPreference;

  @IsOptional()
  @IsEnum(MapVisualDtoPreference)
  mapVisual?: MapVisualDtoPreference;
}
