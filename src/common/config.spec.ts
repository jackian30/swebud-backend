import { ConfigService } from '@nestjs/config';
import { booleanConfig } from './config';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('config helpers', () => {
  it('parses common enabled boolean env values', () => {
    expect(booleanConfig(config({ FEATURE_FLAG: ' yes ' }), 'FEATURE_FLAG')).toBe(true);
    expect(booleanConfig(config({ FEATURE_FLAG: 'ON' }), 'FEATURE_FLAG')).toBe(true);
  });

  it('uses fallback for missing or empty values', () => {
    expect(booleanConfig(config({}), 'FEATURE_FLAG', true)).toBe(true);
    expect(booleanConfig(config({ FEATURE_FLAG: '' }), 'FEATURE_FLAG', true)).toBe(true);
  });

  it('treats other configured values as false', () => {
    expect(booleanConfig(config({ FEATURE_FLAG: 'false' }), 'FEATURE_FLAG', true)).toBe(false);
  });
});
