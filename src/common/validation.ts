import { IsOptional, ValidateIf } from 'class-validator';

/** Optional means the property may be omitted, but an explicit null is invalid. */
export function IsOptionalNonNull(): PropertyDecorator {
  return ValidateIf((_object, value) => value !== undefined);
}

/** Use only when null is an intentional API value that clears stored data. */
export function IsOptionalOrNull(): PropertyDecorator {
  return IsOptional();
}
