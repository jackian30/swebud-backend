import { ConfigService } from '@nestjs/config';
import { assertMeetsMinimumAccountAge, isAtLeastAge } from './account-age';

function config(minimumAge?: string) {
  return {
    get: jest.fn((key: string) => key === 'MINIMUM_ACCOUNT_AGE' ? minimumAge : undefined),
  } as unknown as ConfigService;
}

describe('minimum account age', () => {
  const now = new Date('2026-07-27T12:00:00.000Z');

  it('uses exact UTC calendar dates at the default 18-year boundary', () => {
    expect(isAtLeastAge(new Date('2008-07-27T23:59:59.000Z'), 18, now)).toBe(true);
    expect(isAtLeastAge(new Date('2008-07-28T00:00:00.000Z'), 18, now)).toBe(false);
  });

  it('rejects future and underage dates with the configured policy in the error', () => {
    expect(() => assertMeetsMinimumAccountAge(new Date('2010-01-01T00:00:00.000Z'), config(), now))
      .toThrow('at least 18 years old');
    expect(() => assertMeetsMinimumAccountAge(new Date('2008-01-01T00:00:00.000Z'), config('21'), now))
      .toThrow('at least 21 years old');
  });

  it('accepts an adult on the configured boundary', () => {
    expect(() => assertMeetsMinimumAccountAge(new Date('2005-07-27T00:00:00.000Z'), config('21'), now))
      .not.toThrow();
  });
});
