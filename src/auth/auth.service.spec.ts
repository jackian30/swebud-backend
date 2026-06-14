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

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, { where: { username: 'elenadiaz' }, select: { id: true } });
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, { where: { username: 'elenadiaz2' }, select: { id: true } });
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ username: 'elenadiaz2' }),
    }));
  });
});

describe('AuthService refresh login sessions', () => {
  it('rotates refresh tokens without creating another visible login session', async () => {
    const tokenHash = await bcrypt.hash('refresh-token', 4);
    const prisma: any = {
      refreshToken: {
        findMany: jest.fn().mockResolvedValue([{ id: 'refresh-1', userId: 'user-1', loginSessionId: 'login-session-1', tokenHash }]),
        update: jest.fn().mockResolvedValue({ id: 'refresh-1' }),
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
      verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', email: 'user@example.com', sid: 'refresh-1', lid: 'login-session-1' }),
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

    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'refresh-1' },
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
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        loginSessionId: 'login-session-1',
        tokenHash: expect.any(String),
      }),
    });
  });
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
