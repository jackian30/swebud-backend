import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminJwtGuard } from './admin-jwt.guard';

describe('AdminJwtGuard', () => {
  const secret = 'admin-test-secret-that-is-long-and-independent';
  const issuer = 'swebudd-admin';
  const audience = 'swebudd-admin-moderation';
  const jwt = new JwtService();

  function config() {
    return {
      get: jest.fn((key: string) => ({
        ADMIN_JWT_SECRET: secret,
        ADMIN_JWT_ISSUER: issuer,
        ADMIN_JWT_AUDIENCE: audience,
      })[key]),
    };
  }

  function prisma() {
    return {
      adminJwtJti: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
  }

  function token(options: {
    subject?: string;
    tokenIssuer?: string;
    tokenAudience?: string | string[];
    expiresIn?: number;
    amr?: string[];
    scope?: string;
    jti?: string;
    algorithm?: 'HS256' | 'HS384';
  } = {}) {
    return jwt.sign({
      amr: options.amr ?? ['pwd', 'mfa'],
      scope: options.scope ?? 'moderation:reports:read',
    }, {
      secret,
      algorithm: options.algorithm ?? 'HS256',
      issuer: options.tokenIssuer ?? issuer,
      audience: options.tokenAudience ?? audience,
      subject: options.subject ?? 'admin:1',
      jwtid: options.jti ?? 'admin-request-00000001',
      expiresIn: options.expiresIn ?? 300,
    });
  }

  function context(value: string) {
    const request = { headers: { authorization: `Bearer ${value}` } };
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as any,
    };
  }

  it('accepts a scoped MFA HS256 token and consumes its jti once', async () => {
    const db = prisma();
    const guard = new AdminJwtGuard(jwt, config() as any, db as any);
    const { request, context: execution } = context(token());

    await expect(guard.canActivate(execution)).resolves.toBe(true);
    expect(request).toHaveProperty('admin', expect.objectContaining({
      id: 'admin:1',
      jti: 'admin-request-00000001',
      scopes: ['moderation:reports:read'],
    }));
    expect(db.adminJwtJti.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jti: 'admin-request-00000001',
        actorId: 'admin:1',
        expiresAt: expect.any(Date),
      }),
    });
  });

  it.each([
    ['unnamespaced bigint', '1'],
    ['wrong namespace', 'support:1'],
    ['empty identifier', 'admin:'],
    ['nested namespace', 'admin:team:1'],
    ['zero identifier', 'admin:0'],
    ['leading zero', 'admin:01'],
    ['non-numeric identifier', 'admin:reviewer-1'],
    ['identifier longer than 122 digits', `admin:${'1'.repeat(123)}`],
  ])('rejects the invalid admin subject format %s', async (_label, subject) => {
    const guard = new AdminJwtGuard(jwt, config() as any, prisma() as any);
    await expect(guard.canActivate(context(token({ subject })).context))
      .rejects.toThrow('Admin token subject is invalid');
  });

  it('accepts the largest canonical numeric subject allowed by the contract', async () => {
    const guard = new AdminJwtGuard(jwt, config() as any, prisma() as any);
    await expect(guard.canActivate(context(token({
      subject: `admin:${'9'.repeat(122)}`,
    })).context)).resolves.toBe(true);
  });

  it.each([
    ['wrong issuer', { tokenIssuer: 'other-admin' }],
    ['wrong audience', { tokenAudience: 'other-audience' }],
    ['array audience', { tokenAudience: [audience] }],
    ['more than five minutes', { expiresIn: 301 }],
    ['missing MFA', { amr: ['pwd'] }],
    ['missing scopes', { scope: '' }],
    ['wrong HMAC algorithm', { algorithm: 'HS384' as const }],
  ])('rejects %s', async (_label, options) => {
    const guard = new AdminJwtGuard(jwt, config() as any, prisma() as any);
    await expect(guard.canActivate(context(token(options)).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a replayed jti', async () => {
    const db = prisma();
    db.adminJwtJti.create.mockRejectedValue({ code: 'P2002' });
    const guard = new AdminJwtGuard(jwt, config() as any, db as any);

    await expect(guard.canActivate(context(token()).context))
      .rejects.toThrow('Admin token has already been used');
  });

  it('deletes at most one bounded page of expired jtis before consuming a token', async () => {
    const db = prisma();
    db.adminJwtJti.findMany.mockResolvedValue([{ jti: 'expired-jti-0001' }]);
    const guard = new AdminJwtGuard(jwt, config() as any, db as any);

    await guard.canActivate(context(token()).context);

    expect(db.adminJwtJti.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      orderBy: { expiresAt: 'asc' },
    }));
    expect(db.adminJwtJti.deleteMany).toHaveBeenCalledWith({
      where: { jti: { in: ['expired-jti-0001'] } },
    });
  });
});
