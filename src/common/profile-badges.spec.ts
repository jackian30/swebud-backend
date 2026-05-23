import { availableProfileBadgesFor, exposeProfileBadges, profileBadgesFor } from './profile-badges';

describe('profile badges', () => {
  it('marks beta users with a beta badge', () => {
    expect(profileBadgesFor({ betaUser: true })).toEqual([{
      code: 'beta_user',
      label: 'Beta User',
      description: 'Early SweBudd beta user',
      iconUrl: '/icons/profile-badges/beta-user.svg',
    }]);
  });

  it('hides badges when profile badges are disabled', () => {
    expect(profileBadgesFor({ betaUser: true, hideProfileBadges: true })).toEqual([]);
  });

  it('hides selected badge codes only', () => {
    expect(profileBadgesFor({
      betaUser: true,
      hiddenProfileBadgeCodes: ['beta_user'],
      badges: [{ badge: { code: 'founding_member', label: 'Founding Member', description: 'Original SweBudd member', iconUrl: '/icons/profile-badges/founding-member.svg', active: true } }],
    })).toEqual([{ code: 'founding_member', label: 'Founding Member', description: 'Original SweBudd member', iconUrl: '/icons/profile-badges/founding-member.svg' }]);
  });

  it('can list available badges even when profile badges are hidden', () => {
    expect(availableProfileBadgesFor({ betaUser: true, hideProfileBadges: true }).map((badge) => badge.code)).toContain('beta_user');
  });

  it('respects inactive database-backed beta badge metadata', () => {
    expect(profileBadgesFor({
      betaUser: true,
      badges: [{ badge: { code: 'beta_user', label: 'Beta User', description: 'Early SweBudd beta user', iconUrl: '/icons/profile-badges/beta-user.svg', active: false } }],
    })).toEqual([]);
  });

  it('does not expose the internal beta flag', () => {
    expect(exposeProfileBadges({ id: 'user-1', betaUser: true })).toEqual({
      id: 'user-1',
      badges: [{
        code: 'beta_user',
        label: 'Beta User',
        description: 'Early SweBudd beta user',
        iconUrl: '/icons/profile-badges/beta-user.svg',
      }],
    });
  });

  it('uses database-backed badge metadata', () => {
    expect(profileBadgesFor({
      badges: [{ badge: { code: 'founding_member', label: 'Founding Member', description: 'Original SweBudd member', iconUrl: '/icons/profile-badges/founding-member.svg', active: true } }],
    })).toEqual([{ code: 'founding_member', label: 'Founding Member', description: 'Original SweBudd member', iconUrl: '/icons/profile-badges/founding-member.svg' }]);
  });
});
