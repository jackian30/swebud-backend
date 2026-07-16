export type ModerationState = {
  moderationStatus?: string | null;
  bannedAt?: Date | null;
  bannedUntil?: Date | null;
};

export const moderationStateSelect = {
  moderationStatus: true,
  bannedAt: true,
  bannedUntil: true,
} as const;

export type OnboardingState = {
  usernameFinalized?: boolean | null;
  dateOfBirth?: Date | null;
  legalConsentAt?: Date | null;
  dataConsentAt?: Date | null;
};

export const onboardingStateSelect = {
  usernameFinalized: true,
  dateOfBirth: true,
  legalConsentAt: true,
  dataConsentAt: true,
} as const;

export function isAccountBanned(user: ModerationState, now = Date.now()) {
  if (user.moderationStatus !== 'banned' && !user.bannedAt) return false;
  return !user.bannedUntil || user.bannedUntil.getTime() > now;
}

export function isOnboardingComplete(user: OnboardingState) {
  return Boolean(
    user.usernameFinalized
    && user.dateOfBirth
    && user.legalConsentAt
    && user.dataConsentAt,
  );
}
