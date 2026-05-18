export type ProfileBadge = {
  code: string;
  label: string;
  description?: string | null;
  iconUrl: string;
};

type ProfileBadgeUser = {
  betaUser?: boolean | null;
  hideProfileBadges?: boolean | null;
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
  const badges = (user.badges ?? [])
    .map((userBadge) => userBadge.badge)
    .filter((badge) => badge.active !== false)
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.label.localeCompare(right.label))
    .map(({ code, label, description, iconUrl }) => ({ code, label, description, iconUrl }));

  if (!badges.some((badge) => badge.code === 'beta_user') && user.betaUser) {
    badges.push({
      code: 'beta_user',
      label: 'Beta User',
      description: 'Early SweBudd beta user',
      iconUrl: '/icons/profile-badges/beta-user.svg',
    });
  }

  return badges;
}

export function exposeProfileBadges<T extends ProfileBadgeUser>(user: T): Omit<T, 'betaUser' | 'badges'> & { badges: ProfileBadge[] } {
  const { betaUser, badges, ...publicUser } = user;
  void betaUser;
  void badges;
  return { ...publicUser, badges: profileBadgesFor(user) };
}
