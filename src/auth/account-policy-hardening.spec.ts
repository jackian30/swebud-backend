import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../users/users.service';

const adultDate = new Date('1990-01-01T00:00:00.000Z');
const underageDate = new Date('2012-01-01T00:00:00.000Z');

function config() {
  return {
    get: jest.fn((key: string) => key === 'MINIMUM_ACCOUNT_AGE' ? '18' : undefined),
  };
}

describe('DOB immutability and legacy age policy', () => {
  afterEach(() => jest.restoreAllMocks());

  it('atomically fills a missing DOB but translates an existing-DOB update into a support-only error', async () => {
    const prisma = {
      user: {
        update: jest.fn().mockRejectedValue({ code: 'P2025' }),
      },
    };
    const service = new UsersService(prisma as any, {} as any, config() as any, {} as any);

    await expect(service.updateMe('user-1', { dateOfBirth: adultDate }))
      .rejects.toThrow('Birth date can only be corrected by account support');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', dateOfBirth: null },
      data: expect.objectContaining({ dateOfBirth: adultDate }),
    }));
  });

  it('makes both onboarding service entry points fill-once and rejects an existing DOB', async () => {
    const usersPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockRejectedValue({ code: 'P2025' }),
      },
    };
    const users = new UsersService(usersPrisma as any, {} as any, config() as any, {} as any);
    await expect(users.completeOnboarding('user-1', {
      username: 'adult-user',
      dateOfBirth: adultDate,
      legalConsent: true,
      dataConsent: true,
    })).rejects.toThrow('Onboarding is already complete');
    expect(usersPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', dateOfBirth: null },
    }));

    const tx = {
      user: { update: jest.fn().mockRejectedValue({ code: 'P2025' }) },
      refreshToken: { updateMany: jest.fn() },
    };
    const authPrisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const auth = new AuthService(
      authPrisma as any,
      {} as any,
      config() as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(auth.completeOnboarding('user-1', {
      username: 'adult-user',
      dateOfBirth: adultDate,
      legalConsent: true,
      dataConsent: true,
    }, undefined, 'login-1', 'refresh-1')).rejects.toThrow('Onboarding is already complete');
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', dateOfBirth: null },
    }));
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects legacy underage accounts at password login with a generic policy error', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'legacy@example.com',
          passwordHash: 'hash',
          username: 'legacy',
          usernameFinalized: true,
          dateOfBirth: underageDate,
          moderationStatus: 'active',
          bannedAt: null,
          bannedUntil: null,
        }),
      },
      loginSession: { count: jest.fn() },
    };
    const service = new AuthService(
      prisma as any,
      {} as any,
      config() as any,
      {} as any,
      {} as any,
      { verify: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );

    await expect(service.login({ email: 'legacy@example.com', password: 'password123' }))
      .rejects.toThrow('Account does not meet current account policy');
    expect(prisma.loginSession.count).not.toHaveBeenCalled();
  });

  it('rejects legacy underage accounts before rotating a refresh credential', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const prisma = {
      refreshToken: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'refresh-1',
          tokenHash: 'hash',
          userId: 'user-1',
          loginSessionId: 'login-1',
        }]),
        updateMany: jest.fn(),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'legacy@example.com',
          username: 'legacy',
          usernameFinalized: true,
          dateOfBirth: underageDate,
          moderationStatus: 'active',
          bannedAt: null,
          bannedUntil: null,
        }),
      },
    };
    const service = new AuthService(
      prisma as any,
      { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', sid: 'refresh-1' }) } as any,
      config() as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.refresh('refresh-token'))
      .rejects.toThrow('Account does not meet current account policy');
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects every existing access session for a legacy underage account before extending it', async () => {
    const user = {
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
      usernameFinalized: true,
      dateOfBirth: underageDate,
      legalConsentAt: new Date(),
      dataConsentAt: new Date(),
      emailVerifiedAt: new Date(),
    };
    const prisma = {
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({ id: 'refresh-1', loginSessionId: 'login-1', user }),
        update: jest.fn(),
      },
      loginSession: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const strategy = new JwtStrategy(config() as any, prisma as any);

    await expect(strategy.validate({ sub: 'user-1', sid: 'refresh-1' }))
      .rejects.toThrow('Account does not meet current account policy');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
  });

  it('still allows DOB-null pending users to authenticate only as onboarding-incomplete', async () => {
    const user = {
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
      usernameFinalized: false,
      dateOfBirth: null,
      legalConsentAt: null,
      dataConsentAt: null,
      emailVerifiedAt: null,
    };
    const prisma = {
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({ id: 'refresh-1', loginSessionId: null, user }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const strategy = new JwtStrategy(config() as any, prisma as any);

    await expect(strategy.validate({ sub: 'user-1', sid: 'refresh-1' }))
      .resolves.toEqual(expect.objectContaining({ onboarded: false }));
  });
});
