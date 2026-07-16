import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_ONBOARDING = 'auth:allow-pending-onboarding';

export const AllowPendingOnboarding = () => SetMetadata(ALLOW_PENDING_ONBOARDING, true);
