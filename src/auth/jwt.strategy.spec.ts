import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy onboarding state', () => {
  it.each([
    [false, null],
    [true, new Date('1990-01-01T00:00:00.000Z')],
  ])('derives onboarded=%s from the current database state', async (expected, dateOfBirth) => {
    const user = {
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
      usernameFinalized: true,
      dateOfBirth,
      legalConsentAt: new Date('2026-01-01T00:00:00.000Z'),
      dataConsentAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const prisma = {
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({ id: 'session-1', loginSessionId: 'login-1', user }),
        update: jest.fn().mockResolvedValue({}),
      },
      loginSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const strategy = new JwtStrategy({ get: jest.fn().mockReturnValue(undefined) } as any, prisma as any);

    await expect(strategy.validate({ sub: 'user-1', sid: 'session-1' })).resolves.toEqual({
      id: 'user-1',
      sessionId: 'session-1',
      loginSessionId: 'login-1',
      onboarded: expected,
    });
    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        user: {
          select: expect.objectContaining({
            usernameFinalized: true,
            dateOfBirth: true,
            legalConsentAt: true,
            dataConsentAt: true,
          }),
        },
      }),
    }));
  });
});
