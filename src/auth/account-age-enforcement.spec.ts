import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

const underageDate = new Date('2010-01-01T00:00:00.000Z');

function config() {
  return {
    get: jest.fn((key: string) => key === 'MINIMUM_ACCOUNT_AGE' ? '18' : undefined),
  };
}

describe('account-age enforcement across write paths', () => {
  it('rejects an underage password registration before querying for an account', async () => {
    const prisma = { user: { findFirst: jest.fn() } };
    const service = new AuthService(
      prisma as any,
      {} as any,
      config() as any,
      {} as any,
      {} as any,
      { verify: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );

    await expect(service.register({
      email: 'minor@example.com',
      password: 'password123',
      username: 'minor-user',
      dateOfBirth: underageDate,
      legalConsent: true,
      dataConsent: true,
    })).rejects.toThrow('at least 18 years old');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an underage Google onboarding before changing the user', async () => {
    const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    const service = new AuthService(
      prisma as any,
      {} as any,
      config() as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.completeOnboarding('user-1', {
      username: 'minor-user',
      dateOfBirth: underageDate,
      legalConsent: true,
      dataConsent: true,
    }, undefined, 'login-1', 'session-1')).rejects.toThrow('at least 18 years old');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects underage and removed profile birth dates on both user paths', async () => {
    const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    const service = new UsersService(prisma as any, {} as any, config() as any, {} as any);

    await expect(service.completeOnboarding('user-1', {
      username: 'minor-user',
      dateOfBirth: underageDate,
      legalConsent: true,
      dataConsent: true,
    })).rejects.toThrow('at least 18 years old');
    await expect(service.updateMe('user-1', { dateOfBirth: underageDate }))
      .rejects.toThrow('at least 18 years old');
    await expect(service.updateMe('user-1', { dateOfBirth: null } as any))
      .rejects.toThrow('Birth date cannot be removed');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('exposes the configured policy for client-side copy and validation', () => {
    const service = new AuthService(
      {} as any,
      {} as any,
      config() as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    expect(service.policy()).toEqual({ minimumAccountAge: 18 });
  });
});
