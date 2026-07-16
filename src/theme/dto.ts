import { IsEnum } from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

export enum ThemeDtoPreference { system = 'system', light = 'light', dark = 'dark' }
export enum MapVisualDtoPreference { system = 'system', streets = 'streets', light = 'light', dark = 'dark', satellite = 'satellite' }

export class UpdateThemeDto {
  @IsOptionalNonNull()
  @IsEnum(ThemeDtoPreference)
  theme?: ThemeDtoPreference;

  @IsOptionalNonNull()
  @IsEnum(MapVisualDtoPreference)
  mapVisual?: MapVisualDtoPreference;
}
