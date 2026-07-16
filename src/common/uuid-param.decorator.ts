import { Param, ParseUUIDPipe } from '@nestjs/common';

export function UuidParam(name: string): ParameterDecorator {
  return Param(name, new ParseUUIDPipe());
}
