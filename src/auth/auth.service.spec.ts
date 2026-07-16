import { AuthService, sessionMetadataFromRequest } from './auth.service';
import * as appRelease from '../common/app-version';
import * as bcrypt from 'bcryptjs';

describe('sessionMetadataFromRequest', () => {
  it('captures Android app, IP, and proxy location headers', () => {
    const req = {
      ip: '10.0.0.1',
      socket: {},
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/125.0 Mobile Safari/537.36',
        origin: 'https://localhost',
        'x-forwarded-for': '203.0.113.10, 10.0.0.5',
        'cf-ipcity': 'Makati',
        'cf-region': 'Metro%20Manila',
        'cf-ipcountry': 'PH',
      },
    };

    expect(sessionMetadataFromRequest(req as any)).toEqual({
      ipAddress: '203.0.113.10',
      userAgent: req.headers['user-agent'],
      origin: 'https://localhost',
      deviceLabel: 'Android app',
      locationLabel: 'Makati, Metro Manila, PH',
    });
  });
});

describe('AuthService Google login', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('creates a default username from Google first and last name', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        sub: 'google-1',
        email: 'elena.diaz@example.com',
        email_verified: true,
        given_name: 'Elena',
        family_name: 'Diaz',
        name: 'Elena Diaz',
        picture: 'https://example.com/avatar.jpg',
      }),
    } as any);

    let prisma: any;
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data, select }) => Promise.resolve({
          id: 'user-1',
          ...data,
          bio: null,
          latitude: null,
          longitude: null,
          gender: null,
          dateOfBirth: null,
          activityPersona: null,
          activityPersonas: [],
          legalConsentAt: null,
          dataConsentAt: null,
          ...Object.fromEntries(Object.keys(select).map((key) => [key, (data as any)[key] ?? null])),
        })),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
      },
      loginSession: {
        create: jest.fn().mockResolvedValue({ id: 'login-session-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((callback: (tx: any) => unknown) => callback(prisma)),
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const service = new AuthService(
      prisma as any,
      jwt as any,
      config as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.googleLogin({ idToken: 'id-token' });

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        displayName: 'Elena Diaz',
        username: 'elenadiaz',
        usernameFinalized: false,
      }),
    }));
  });

  it('adds a suffix when a Google name username is already taken', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        sub: 'google-2',
        email: 'elena.alt@example.com',
        email_verified: true,
        given_name: 'Elena',
        family_name: 'Diaz',
      }),
    } as any);

    let prisma: any;
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'existing-user' })
          .mockResolvedValueOnce(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: 'user-2',
          ...data,
          bio: null,
          latitude: null,
          longitude: null,
          gender: null,
          dateOfBirth: null,
          activityPersona: null,
          activityPersonas: [],
          legalConsentAt: null,
          dataConsentAt: null,
        })),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
      },
      loginSession: {
        create: jest.fn().mockResolvedValue({ id: 'login-session-2' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((callback: (tx: any) => unknown) => callback(prisma)),
    };
    const service = new AuthService(
      prisma as any,
      { signAsync: jest.fn().mockResolvedValue('token') } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.googleLogin({ idToken: 'id-token' });

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(3, { where: { username: 'elenadiaz' }, select: { id: true } });
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(4, { where: { username: 'elenadiaz2' }, select: { id: true } });
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ username: 'elenadiaz2' }),
    }));
  });

  it('does not silently link a Google identity to an existing password account with the same email', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        sub: 'google-victim',
        email: 'victim@example.com',
        email_verified: true,
      }),
    } as any);

    const prisma = {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'password-account' }),
        update: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const service = new AuthService(
      prisma as any,
      {} as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.googleLogin({ idToken: 'id-token' })).rejects.toThrow(
      'Google sign-in is not linked to this account',
    );

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('AuthService refresh login sessions', () => {
  it('rotates refresh tokens without creating another visible login session', async () => {
    const tokenHash = await bcrypt.hash('refresh-token', 4);
    const prisma: any = {
      refreshToken: {
        findMany: jest.fn().mockResolvedValue([{ id: 'refresh-1', userId: 'user-1', loginSessionId: 'login-session-1', tokenHash }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'refresh-2' }),
      },
      loginSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'new-login-session' }),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          username: 'runner',
          usernameFinalized: true,
          dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
          legalConsentAt: new Date('2026-01-01T00:00:00.000Z'),
          dataConsentAt: new Date('2026-01-01T00:00:00.000Z'),
          activityPersonas: [],
          badges: [],
        }),
      },
    };
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', sid: 'refresh-1', lid: 'login-session-1' }),
      signAsync: jest.fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('next-refresh-token'),
    };
    const service = new AuthService(
      prisma,
      jwt as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.refresh('refresh-token', {
      deviceLabel: 'Android app',
      locationLabel: 'Makati, PH',
      ipAddress: '203.0.113.10',
      userAgent: 'Android WebView',
    });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'refresh-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.loginSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'login-session-1', userId: 'user-1', revokedAt: null },
      data: expect.objectContaining({
        deviceLabel: 'Android app',
        locationLabel: 'Makati, PH',
        ipAddress: '203.0.113.10',
        userAgent: 'Android WebView',
      }),
    });
    expect(prisma.loginSession.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ lid: 'login-session-1', sid: expect.any(String) }), expect.anything());
    expect(jwt.signAsync).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ expiresIn: 900 }));
    expect(jwt.signAsync).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ expiresIn: 604800 }));
    expect(jwt.signAsync.mock.calls[0][0]).not.toHaveProperty('email');
    expect(jwt.signAsync.mock.calls[1][0]).not.toHaveProperty('email');
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        loginSessionId: 'login-session-1',
        tokenHash: expect.any(String),
      }),
    });
  });

  it('rejects a refresh token when another request already consumed it', async () => {
    const tokenHash = await bcrypt.hash('refresh-token', 4);
    const prisma: any = {
      refreshToken: {
        findMany: jest.fn().mockResolvedValue([{ id: 'refresh-1', userId: 'user-1', loginSessionId: 'login-session-1', tokenHash }]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      user: { findUniqueOrThrow: jest.fn() },
    };
    const service = new AuthService(
      prisma,
      { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', sid: 'refresh-1' }) } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.refresh('refresh-token')).rejects.toThrow('Invalid refresh token');

    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('AuthService onboarding session replacement', () => {
  it('revokes the pending refresh sid before issuing onboarded tokens', async () => {
    const completedUser = {
      id: 'user-1',
      email: 'user@example.com',
      username: 'finished-user',
      usernameFinalized: true,
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      legalConsentAt: new Date('2026-07-16T00:00:00.000Z'),
      dataConsentAt: new Date('2026-07-16T00:00:00.000Z'),
      activityPersonas: [],
      badges: [],
    };
    const tx = {
      user: { update: jest.fn().mockResolvedValue(completedUser) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      loginSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const jwt = { signAsync: jest.fn().mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token') };
    const service = new AuthService(
      prisma as any,
      jwt as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.completeOnboarding('user-1', {
      username: 'finished-user',
      dateOfBirth: completedUser.dateOfBirth,
      legalConsent: true,
      dataConsent: true,
    }, undefined, 'login-1', 'pending-sid')).resolves.toEqual(expect.objectContaining({
      requiresOnboarding: false,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }));

    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'pending-sid', userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', loginSessionId: 'login-1' }),
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ onboarded: true, sid: expect.any(String) }),
      expect.anything(),
    );
  });

  it('does not issue tokens if the pending sid cannot be revoked', async () => {
    const tx = {
      user: { update: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      refreshToken: { create: jest.fn() },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const jwt = { signAsync: jest.fn() };
    const service = new AuthService(
      prisma as any,
      jwt as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.completeOnboarding('user-1', {
      username: 'finished-user',
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      legalConsent: true,
      dataConsent: true,
    }, undefined, 'login-1', 'pending-sid')).rejects.toThrow('Session expired');

    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('AuthService response privacy', () => {
  const originalFetch = global.fetch;
  const sensitiveFields = [
    'latitude',
    'longitude',
    'legalConsentAt',
    'dataConsentAt',
    'googleId',
    'googleEmailVerified',
    'moderationStatus',
    'bannedAt',
    'bannedUntil',
    'banReason',
    'requiresOnboarding',
    'onboardingMissing',
  ];

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function completedSensitiveUser() {
    return {
      id: 'user-private',
      email: 'private@example.com',
      displayName: 'Private User',
      username: 'private-user',
      usernameFinalized: true,
      bio: 'Visible profile text',
      profileImageUrl: '/uploads/avatar.webp',
      latitude: 14.5995,
      longitude: 120.9842,
      gender: 'prefer_not_to_say',
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      activityPersonas: [{ persona: 'runner' }],
      legalConsentAt: new Date('2026-01-01T00:00:00.000Z'),
      dataConsentAt: new Date('2026-01-01T00:00:00.000Z'),
      googleId: 'google-private-id',
      googleEmailVerified: true,
      betaUser: true,
      hideProfileBadges: false,
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: 'internal moderation note',
      badges: [],
    };
  }

  async function responseFor(flow: 'register' | 'login' | 'google' | 'refresh' | 'onboarding') {
    const user = completedSensitiveUser();
    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue(flow === 'login' ? { ...user, passwordHash: 'password-hash' } : null),
        findUnique: jest.fn().mockResolvedValue(flow === 'google' ? user : null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(user),
        create: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue(user),
      },
      refreshToken: {
        findMany: jest.fn().mockResolvedValue([{ id: 'refresh-1', userId: user.id, loginSessionId: 'login-1', tokenHash: 'stored-hash' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'refresh-2' }),
      },
      loginSession: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'login-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction = jest.fn((callback: (client: typeof prisma) => unknown) => callback(prisma));
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ sub: user.id, sid: 'refresh-1', lid: 'login-1' }),
      signAsync: jest.fn().mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token'),
    };
    const service = new AuthService(
      prisma,
      jwt as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      { sendWelcomeEmail: jest.fn().mockResolvedValue(undefined) } as any,
      { create: jest.fn().mockResolvedValue(undefined) } as any,
      { verify: jest.fn().mockResolvedValue(undefined) } as any,
    );
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    switch (flow) {
      case 'register':
        return service.register({
          email: user.email,
          password: 'password123',
          username: user.username,
          displayName: user.displayName,
          dateOfBirth: user.dateOfBirth,
          legalConsent: true,
          dataConsent: true,
        });
      case 'login':
        return service.login({ email: user.email, password: 'password123' });
      case 'google':
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue({
            sub: user.googleId,
            email: user.email,
            email_verified: true,
          }),
        } as any);
        return service.googleLogin({ idToken: 'google-token' });
      case 'refresh':
        return service.refresh('refresh-token');
      case 'onboarding':
        return service.completeOnboarding(user.id, {
          username: user.username,
          dateOfBirth: user.dateOfBirth,
          legalConsent: true,
          dataConsent: true,
        }, undefined, 'login-1', 'refresh-1');
    }
  }

  it.each(['register', 'login', 'google', 'refresh', 'onboarding'] as const)(
    'does not expose private account internals in the %s token response',
    async (flow) => {
      const response = await responseFor(flow);

      expect(response.user).toEqual(expect.objectContaining({
        id: 'user-private',
        email: 'private@example.com',
        onboardingComplete: true,
      }));
      expect(response).toEqual(expect.objectContaining({
        requiresOnboarding: false,
        onboardingMissing: [],
      }));
      for (const field of sensitiveFields) expect(response.user).not.toHaveProperty(field);
    },
  );
});

describe('AuthService password reset URLs', () => {
  it('uses the first allowed frontend origin when multiple CORS origins are configured', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'token-1' }),
      },
    };
    const mail = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((key: string) => key === 'FRONTEND_ORIGIN'
        ? 'http://localhost:9000,https://192.168.18.50:9443'
        : undefined),
    };
    const service = new AuthService(
      prisma as any,
      {} as any,
      config as any,
      mail as any,
      {} as any,
      {} as any,
    );

    await expect(service.forgotPassword(' USER@example.com ')).resolves.toEqual({ ok: true });

    expect(mail.sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      resetUrl: expect.stringMatching(/^http:\/\/localhost:9000\/auth\?mode=reset&token=/),
    }));
    expect(mail.sendPasswordResetEmail.mock.calls[0][0].resetUrl).not.toContain(',');
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.stringMatching(/^[a-f0-9]{32}$/),
        tokenHash: expect.any(String),
      }),
    });
    expect(mail.sendPasswordResetEmail.mock.calls[0][0].resetUrl)
      .toMatch(/token=[a-f0-9]{32}\.[a-f0-9]{64}$/);
  });

  it('does not wait for reset email delivery before returning', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'token-1' }),
      },
    };
    const mail = { sendPasswordResetEmail: jest.fn(() => new Promise(() => undefined)) };
    const config = { get: jest.fn((key: string) => key === 'FRONTEND_ORIGIN' ? 'https://swebudd.com' : undefined) };
    const service = new AuthService(
      prisma as any,
      {} as any,
      config as any,
      mail as any,
      {} as any,
      {} as any,
    );

    await expect(service.forgotPassword('user@example.com')).resolves.toEqual({ ok: true });

    expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('looks up a reset token by its public selector and claims it atomically', async () => {
    const selector = 'a'.repeat(32);
    const secret = 'b'.repeat(64);
    const tokenHash = await bcrypt.hash(secret, 4);
    const tx = {
      passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { update: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      loginSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      passwordResetToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: selector,
          userId: 'user-1',
          tokenHash,
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.resetPassword(`${selector}.${secret}`, 'new-password-value')).resolves.toEqual({ ok: true });

    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { id: selector } });
    expect(prisma.passwordResetToken.findMany).not.toHaveBeenCalled();
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: selector, usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: expect.any(String) },
    });
  });

  it('rejects a reset token if a concurrent request already claimed it', async () => {
    const selector = 'c'.repeat(32);
    const secret = 'd'.repeat(64);
    const tokenHash = await bcrypt.hash(secret, 4);
    const tx = {
      passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: { update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      loginSession: { updateMany: jest.fn() },
    };
    const prisma = {
      passwordResetToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: selector,
          userId: 'user-1',
          tokenHash,
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AuthService(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.resetPassword(`${selector}.${secret}`, 'new-password-value'))
      .rejects.toThrow('Invalid or expired reset token');

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService beta release badge assignment', () => {
  function serviceForVersion(version?: string) {
    jest.spyOn(appRelease, 'appVersion').mockReturnValue(version ?? '0.0.0');
    return new AuthService(
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    ) as any;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks all new users as beta users while the app version is beta', async () => {
    await expect(serviceForVersion('0.2.15-beta').userCreateData({} as any, { email: 'user@example.com' })).resolves.toEqual(expect.objectContaining({
      email: 'user@example.com',
      betaUser: true,
      badges: { create: { badge: { connect: { id: 'badge_beta_user' } }, note: 'Auto-assigned during beta release' } },
    }));
  });

  it('does not auto-assign beta badges after the beta release phase', async () => {
    await expect(serviceForVersion('1.0.0').userCreateData({} as any, { email: 'user@example.com' })).resolves.toEqual(expect.objectContaining({
      email: 'user@example.com',
      betaUser: false,
      badges: undefined,
    }));
  });
});
