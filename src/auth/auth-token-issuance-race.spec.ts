import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

type AccountState = {
  passwordHash: string;
  moderationStatus: 'active' | 'banned';
  bannedAt: Date | null;
  bannedUntil: Date | null;
  banReason: string | null;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function accountUser(state: AccountState) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    displayName: 'User',
    username: 'user',
    usernameFinalized: true,
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    activityPersonas: [],
    legalConsentAt: new Date('2026-01-01T00:00:00.000Z'),
    dataConsentAt: new Date('2026-01-01T00:00:00.000Z'),
    moderationStatus: state.moderationStatus,
    bannedAt: state.bannedAt,
    bannedUntil: state.bannedUntil,
    banReason: state.banReason,
    badges: [],
  };
}

function lockedAccount(state: AccountState) {
  return {
    id: 'user-1',
    passwordHash: state.passwordHash,
    email: 'user@example.com',
    googleId: null,
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
    moderationStatus: state.moderationStatus,
    bannedAt: state.bannedAt,
    bannedUntil: state.bannedUntil,
    banReason: state.banReason,
    usernameFinalized: true,
    legalConsentAt: new Date('2026-01-01T00:00:00.000Z'),
    dataConsentAt: new Date('2026-01-01T00:00:00.000Z'),
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function resetToken() {
  return {
    raw: `${'a'.repeat(32)}.${'b'.repeat(64)}`,
    stored: {
      id: 'a'.repeat(32),
      userId: 'user-1',
      tokenHash: 'stored-reset-hash',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    },
  };
}

describe('AuthService token issuance serialization', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects a password login whose password snapshot became stale during password reset', async () => {
    const state: AccountState = {
      passwordHash: 'old-password-hash',
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
    };
    const countReached = deferred();
    const releaseCount = deferred();
    const token = resetToken();
    const prisma: any = {
      user: {
        findFirst: jest.fn().mockImplementation(() => ({
          ...accountUser(state),
          passwordHash: state.passwordHash,
        })),
        findUnique: jest.fn().mockImplementation(() => accountUser(state)),
        update: jest.fn().mockImplementation(({ data }) => {
          state.passwordHash = data.passwordHash;
          return accountUser(state);
        }),
      },
      passwordResetToken: {
        findUnique: jest.fn().mockResolvedValue(token.stored),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      loginSession: {
        count: jest.fn().mockImplementation(async () => {
          countReached.resolve();
          await releaseCount.promise;
          return 0;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockImplementation(() => [lockedAccount(state)]),
    };
    prisma.$transaction = jest.fn((work: (tx: typeof prisma) => unknown) => work(prisma));
    const jwt = { signAsync: jest.fn() };
    const service = new AuthService(
      prisma,
      jwt as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      { verify: jest.fn().mockResolvedValue(undefined) } as any,
    );
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    jest.spyOn(bcrypt, 'hash').mockImplementation(async (value) => (
      value === 'new-password-value' ? 'new-password-hash' : 'new-token-hash'
    ));

    const login = service.login({
      email: 'user@example.com',
      password: 'old-password-value',
    });
    await countReached.promise;
    await expect(service.resetPassword(token.raw, 'new-password-value'))
      .resolves.toEqual({ ok: true });
    releaseCount.resolve();

    await expect(login).rejects.toThrow('Account credentials changed; sign in again');
    expect(prisma.loginSession.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('rejects refresh issuance when an admin ban commits before the user lock is acquired', async () => {
    const state: AccountState = {
      passwordHash: 'password-hash',
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
    };
    const transactionReached = deferred();
    const releaseTransaction = deferred();
    let refreshTokenActive = true;
    const prisma: any = {
      user: {
        findUniqueOrThrow: jest.fn().mockImplementation(() => accountUser(state)),
        findUnique: jest.fn().mockImplementation(() => accountUser(state)),
      },
      refreshToken: {
        findMany: jest.fn().mockImplementation(() => refreshTokenActive
          ? [{
              id: 'refresh-1',
              userId: 'user-1',
              loginSessionId: 'login-1',
              tokenHash: 'stored-refresh-hash',
            }]
          : []),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      loginSession: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockImplementation(() => [lockedAccount(state)]),
      $transaction: jest.fn(async (work: (tx: any) => unknown) => {
        transactionReached.resolve();
        await releaseTransaction.promise;
        return work(prisma);
      }),
    };
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        sid: 'refresh-1',
        lid: 'login-1',
      }),
      signAsync: jest.fn(),
    };
    const service = new AuthService(
      prisma,
      jwt as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const refresh = service.refresh('refresh-token');
    await transactionReached.promise;
    state.moderationStatus = 'banned';
    state.bannedAt = new Date();
    state.banReason = 'Safety review';
    refreshTokenActive = false;
    releaseTransaction.resolve();

    await expect(refresh).rejects.toThrow('Account banned: Safety review');
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('cannot replace a refresh token revoked by a password reset while issuance waits for the user lock', async () => {
    const state: AccountState = {
      passwordHash: 'old-password-hash',
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
    };
    const transactionReached = deferred();
    const releaseRefreshTransaction = deferred();
    const token = resetToken();
    let transactionCalls = 0;
    let refreshTokenActive = true;
    const prisma: any = {
      user: {
        findUniqueOrThrow: jest.fn().mockImplementation(() => accountUser(state)),
        findUnique: jest.fn().mockImplementation(() => accountUser(state)),
        update: jest.fn().mockImplementation(({ data }) => {
          state.passwordHash = data.passwordHash;
          return accountUser(state);
        }),
      },
      passwordResetToken: {
        findUnique: jest.fn().mockResolvedValue(token.stored),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        findMany: jest.fn().mockImplementation(() => refreshTokenActive
          ? [{
              id: 'refresh-1',
              userId: 'user-1',
              loginSessionId: 'login-1',
              tokenHash: 'stored-refresh-hash',
            }]
          : []),
        updateMany: jest.fn().mockImplementation(({ where }) => {
          const wasActive = refreshTokenActive;
          if (where.id || where.userId) refreshTokenActive = false;
          return { count: wasActive ? 1 : 0 };
        }),
        create: jest.fn(),
      },
      loginSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockImplementation(() => [lockedAccount(state)]),
    };
    prisma.$transaction = jest.fn(async (work: (tx: typeof prisma) => unknown) => {
      transactionCalls += 1;
      if (transactionCalls === 1) {
        transactionReached.resolve();
        await releaseRefreshTransaction.promise;
      }
      return work(prisma);
    });
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        sid: 'refresh-1',
        lid: 'login-1',
      }),
      signAsync: jest.fn(),
    };
    const service = new AuthService(
      prisma,
      jwt as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('new-password-hash' as never);

    const refresh = service.refresh('refresh-token');
    await transactionReached.promise;
    await expect(service.resetPassword(token.raw, 'new-password-value'))
      .resolves.toEqual({ ok: true });
    releaseRefreshTransaction.resolve();

    await expect(refresh).rejects.toThrow('Invalid refresh token');
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('does not restore a stale Google link when an email change commits before the account lock is acquired', async () => {
    const state: AccountState & {
      email: string;
      googleId: string | null;
      googleEmailVerified: boolean;
      emailVerifiedAt: Date | null;
    } = {
      passwordHash: 'password-hash',
      email: 'old@example.com',
      googleId: 'google-1',
      googleEmailVerified: true,
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
    };
    const transactionReached = deferred();
    const releaseGoogleTransaction = deferred();
    let transactionCalls = 0;
    const currentUser = () => ({
      ...accountUser(state),
      email: state.email,
      googleId: state.googleId,
      googleEmailVerified: state.googleEmailVerified,
      emailVerifiedAt: state.emailVerifiedAt,
    });
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.googleId === 'google-1') {
            return Promise.resolve(state.googleId === 'google-1' ? currentUser() : null);
          }
          if (where.id === 'user-1') return Promise.resolve(currentUser());
          if (where.email) return Promise.resolve(null);
          return Promise.resolve(null);
        }),
        findUniqueOrThrow: jest.fn().mockImplementation(() => ({
          id: 'user-1',
          email: state.email,
          passwordHash: state.passwordHash,
        })),
        update: jest.fn().mockImplementation(({ data }) => {
          if (data.email !== undefined) state.email = data.email;
          if (data.googleId !== undefined) state.googleId = data.googleId;
          if (data.googleEmailVerified !== undefined) {
            state.googleEmailVerified = data.googleEmailVerified;
          }
          if (data.emailVerifiedAt !== undefined) state.emailVerifiedAt = data.emailVerifiedAt;
          return Promise.resolve(currentUser());
        }),
      },
      emailVerificationToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      loginSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockImplementation(() => [{
        id: 'user-1',
        email: state.email,
        passwordHash: state.passwordHash,
        googleId: state.googleId,
      }]),
    };
    prisma.$transaction = jest.fn(async (work: (tx: typeof prisma) => unknown) => {
      transactionCalls += 1;
      if (transactionCalls === 1) {
        transactionReached.resolve();
        await releaseGoogleTransaction.promise;
      }
      return work(prisma);
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        sub: 'google-1',
        email: 'old@example.com',
        email_verified: true,
      }),
    } as any);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const auth = new AuthService(
      prisma,
      { signAsync: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const users = new UsersService(
      prisma,
      {} as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      null as any,
    );

    const googleLogin = auth.googleLogin({ idToken: 'google-token' });
    await transactionReached.promise;
    await expect(users.updateAccount('user-1', {
      email: 'new@example.com',
      currentPassword: 'password-value',
    })).resolves.toEqual(expect.objectContaining({
      email: 'new@example.com',
      emailVerified: false,
    }));
    releaseGoogleTransaction.resolve();

    await expect(googleLogin).rejects.toThrow('Google sign-in is no longer linked to this account');
    expect(state.email).toBe('new@example.com');
    expect(state.googleId).toBeNull();
    expect(prisma.user.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ googleId: 'google-1' }),
    }));
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('cannot replace a refresh token after manual session revocation wins the user lock', async () => {
    const state: AccountState = {
      passwordHash: 'password-hash',
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
    };
    const transactionReached = deferred();
    const releaseRefreshTransaction = deferred();
    let transactionCalls = 0;
    let refreshTokenActive = true;
    let loginSessionActive = true;
    const prisma: any = {
      user: {
        findUniqueOrThrow: jest.fn().mockImplementation(() => accountUser(state)),
        findUnique: jest.fn().mockImplementation(() => accountUser(state)),
      },
      refreshToken: {
        findMany: jest.fn().mockImplementation(() => refreshTokenActive
          ? [{
              id: 'refresh-1',
              userId: 'user-1',
              loginSessionId: 'login-1',
              tokenHash: 'stored-refresh-hash',
            }]
          : []),
        updateMany: jest.fn().mockImplementation(({ where }) => {
          if (where.loginSessionId === 'login-1') {
            const wasActive = refreshTokenActive;
            refreshTokenActive = false;
            return { count: wasActive ? 1 : 0 };
          }
          if (where.id === 'refresh-1') {
            const wasActive = refreshTokenActive;
            refreshTokenActive = false;
            return { count: wasActive ? 1 : 0 };
          }
          return { count: 0 };
        }),
        create: jest.fn(),
      },
      loginSession: {
        updateMany: jest.fn().mockImplementation(() => {
          const wasActive = loginSessionActive;
          loginSessionActive = false;
          return { count: wasActive ? 1 : 0 };
        }),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockImplementation(() => [lockedAccount(state)]),
    };
    prisma.$transaction = jest.fn(async (work: (tx: typeof prisma) => unknown) => {
      transactionCalls += 1;
      if (transactionCalls === 1) {
        transactionReached.resolve();
        await releaseRefreshTransaction.promise;
      }
      return work(prisma);
    });
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        sid: 'refresh-1',
        lid: 'login-1',
      }),
      signAsync: jest.fn(),
    };
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const auth = new AuthService(
      prisma,
      jwt as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const users = new UsersService(
      prisma,
      {} as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      null as any,
    );

    const refresh = auth.refresh('refresh-token');
    await transactionReached.promise;
    await expect(users.revokeSession('user-1', 'login-1')).resolves.toEqual({ ok: true });
    releaseRefreshTransaction.resolve();

    await expect(refresh).rejects.toThrow('Invalid refresh token');
    expect(refreshTokenActive).toBe(false);
    expect(loginSessionActive).toBe(false);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.loginSession.updateMany.mock.invocationCallOrder[0]);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
