import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { minimumAccountAge } from './config';

export function assertMeetsMinimumAccountAge(
  dateOfBirth: Date,
  config?: ConfigService,
  now = new Date(),
) {
  const requiredAge = minimumAccountAge(config);
  if (!isAtLeastAge(dateOfBirth, requiredAge, now)) {
    throw new BadRequestException(`You must be at least ${requiredAge} years old to create or use an account`);
  }
}

export function assertExistingAccountMeetsAgePolicy(
  dateOfBirth: Date | null | undefined,
  config?: ConfigService,
  now = new Date(),
) {
  if (dateOfBirth && !isAtLeastAge(dateOfBirth, minimumAccountAge(config), now)) {
    throw new UnauthorizedException('Account does not meet current account policy');
  }
}

export function isAtLeastAge(dateOfBirth: Date, requiredAge: number, now = new Date()) {
  if (
    !Number.isInteger(requiredAge)
    || requiredAge < 0
    || !(dateOfBirth instanceof Date)
    || Number.isNaN(dateOfBirth.getTime())
    || !(now instanceof Date)
    || Number.isNaN(now.getTime())
  ) {
    return false;
  }

  const birthDateUtc = Date.UTC(
    dateOfBirth.getUTCFullYear(),
    dateOfBirth.getUTCMonth(),
    dateOfBirth.getUTCDate(),
  );
  const latestEligibleBirthDateUtc = Date.UTC(
    now.getUTCFullYear() - requiredAge,
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return birthDateUtc <= latestEligibleBirthDateUtc;
}
