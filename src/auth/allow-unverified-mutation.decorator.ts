import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_MUTATION = 'auth:allow-unverified-mutation';

export const AllowUnverifiedMutation = (rationale: string) => (
  SetMetadata(ALLOW_UNVERIFIED_MUTATION, rationale)
);
