import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';

describe('email changes require fresh verification', () => {
  afterEach(() => jest.restoreAllMocks());

  it('clears the prior proof and sends a token to the new password-account email', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const updatedUser = {
      id: 'user-1',
      email: 'new@example.com',
      displayName: 'Runner',
      username: 'runner',
      usernameFinalized: true,
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      emailVerifiedAt: null,
      legalConsentAt: new Date(),
      dataConsentAt: new Date(),
      activityPersonas: [],
      badges: [],
    };
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{
        id: 'user-1',
        email: 'old@example.com',
        passwordHash: 'hash',
      }]),
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'old@example.com',
          passwordHash: 'hash',
        }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(updatedUser),
      },
      emailVerificationToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      loginSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((work: (tx: typeof prisma) => unknown) => work(prisma));
    const emailVerification = { sendForUser: jest.fn().mockResolvedValue(true) };
    const service = new UsersService(
      prisma as any,
      {} as any,
      { get: jest.fn() } as any,
      emailVerification as any,
    );

    const response = await service.updateAccount('user-1', {
      email: ' NEW@example.com ',
      currentPassword: 'password123',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: {
        email: 'new@example.com',
        emailVerifiedAt: null,
        emailVerificationSentAt: null,
        googleId: null,
        googleEmailVerified: false,
      },
    }));
    expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.loginSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.updateMany.mock.calls[0][0].data.revokedAt)
      .toBe(prisma.loginSession.updateMany.mock.calls[0][0].data.revokedAt);
    expect(emailVerification.sendForUser).toHaveBeenCalledWith('user-1', true);
    expect(response).toEqual(expect.objectContaining({ email: 'new@example.com', emailVerified: false }));
  });

  it('commits old email/reset token invalidation before issuing the new token, even if issuance fails', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const events: string[] = [];
    const updatedUser = {
      id: 'user-1',
      email: 'new@example.com',
      displayName: 'Runner',
      username: 'runner',
      usernameFinalized: true,
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      emailVerifiedAt: null,
      legalConsentAt: new Date(),
      dataConsentAt: new Date(),
      activityPersonas: [],
      badges: [],
    };
    const prisma: any = {
      $queryRaw: jest.fn().mockImplementation(() => {
        events.push('user-locked');
        return Promise.resolve([{ id: 'user-1', email: 'old@example.com', passwordHash: 'hash' }]);
      }),
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'old@example.com',
          passwordHash: 'hash',
        }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(() => {
          events.push('email-updated');
          return Promise.resolve(updatedUser);
        }),
      },
      emailVerificationToken: {
        updateMany: jest.fn().mockImplementation(() => {
          events.push('email-tokens-invalidated');
          return Promise.resolve({ count: 1 });
        }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockImplementation(() => {
          events.push('reset-tokens-invalidated');
          return Promise.resolve({ count: 1 });
        }),
      },
      refreshToken: {
        updateMany: jest.fn().mockImplementation(() => {
          events.push('refresh-tokens-revoked');
          return Promise.resolve({ count: 2 });
        }),
      },
      loginSession: {
        updateMany: jest.fn().mockImplementation(() => {
          events.push('login-sessions-revoked');
          return Promise.resolve({ count: 1 });
        }),
      },
      $transaction: jest.fn(async (work: (tx: any) => unknown) => {
        events.push('transaction-started');
        const result = await work(prisma);
        events.push('transaction-committed');
        return result;
      }),
    };
    const emailVerification = {
      sendForUser: jest.fn().mockImplementation(() => {
        events.push('new-token-issuance-attempted');
        return Promise.reject(new Error('mail pipeline unavailable'));
      }),
    };
    const service = new UsersService(
      prisma,
      {} as any,
      { get: jest.fn() } as any,
      emailVerification as any,
    );

    await expect(service.updateAccount('user-1', {
      email: 'new@example.com',
      currentPassword: 'password123',
    })).resolves.toEqual(expect.objectContaining({ email: 'new@example.com', emailVerified: false }));

    expect(events).toEqual([
      'transaction-started',
      'user-locked',
      'email-updated',
      'email-tokens-invalidated',
      'reset-tokens-invalidated',
      'refresh-tokens-revoked',
      'login-sessions-revoked',
      'transaction-committed',
      'new-token-issuance-attempted',
    ]);
  });
});
