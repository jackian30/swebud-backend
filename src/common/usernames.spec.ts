import { normalizeUsername } from './usernames';

describe('username helpers', () => {
  it('normalizes user-entered usernames for persistence', () => {
    expect(normalizeUsername(' @Swe Bud!_01 ')).toBe('swebud_01');
  });

  it('returns an empty string for missing usernames', () => {
    expect(normalizeUsername()).toBe('');
  });
});
