export type ProfileBadge = {
  code: string;
  label: string;
  description?: string | null;
  iconUrl: string;
};

type ProfileBadgeUser = {
  betaUser?: boolean | null;
  hideProfileBadges?: boolean | null;
  hiddenProfileBadgeCodes?: string[] | null;
  badges?: Array<{
    badge: {
      code: string;
      label: string;
      description?: string | null;
      iconUrl: string;
      active?: boolean | null;
      sortOrder?: number | null;
    };
  }> | null;
};

export const profileBadgeSelect = {
  badge: {
    select: {
      code: true,
      label: true,
      description: true,
      iconUrl: true,
      active: true,
      sortOrder: true,
    },
  },
} as const;

export function profileBadgesFor(user: ProfileBadgeUser): ProfileBadge[] {
  if (user.hideProfileBadges) return [];
  const hiddenCodes = new Set(user.hiddenProfileBadgeCodes ?? []);
  const userBadges = Array.isArray(user.badges) ? user.badges : [];
  const hasDatabaseBetaBadge = userBadges.some((userBadge) => userBadge.badge.code === 'beta_user');
  const badges = userBadges
    .map((userBadge) => userBadge.badge)
    .filter((badge) => badge.active !== false)
    .filter((badge) => !hiddenCodes.has(badge.code))
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.label.localeCompare(right.label))
    .map(({ code, label, description, iconUrl }) => ({ code, label, description, iconUrl }));

  if (!hasDatabaseBetaBadge && !hiddenCodes.has('beta_user') && !badges.some((badge) => badge.code === 'beta_user') && user.betaUser) {
    badges.push({
      code: 'beta_user',
      label: 'Beta User',
      description: 'Early SweBudd beta user',
      iconUrl: '/icons/profile-badges/beta-user.svg',
    });
  }

  return badges;
}

export function availableProfileBadgesFor(user: ProfileBadgeUser): ProfileBadge[] {
  return profileBadgesFor({ ...user, hideProfileBadges: false, hiddenProfileBadgeCodes: [] });
}

export function exposeProfileBadges<T extends ProfileBadgeUser>(user: T): Omit<T, 'betaUser' | 'badges' | 'hiddenProfileBadgeCodes'> & { badges: ProfileBadge[] } {
  const { betaUser, badges, hiddenProfileBadgeCodes, ...publicUser } = user;
  void betaUser;
  void badges;
  void hiddenProfileBadgeCodes;
  return { ...publicUser, badges: profileBadgesFor(user) };
}
