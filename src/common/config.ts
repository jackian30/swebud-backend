import { ConfigService } from '@nestjs/config';

export function booleanConfig(config: ConfigService, key: string, fallback = false) {
  const raw = config.get<string>(key);
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}
