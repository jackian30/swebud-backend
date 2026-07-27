import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import {
  ADMIN_JWT_MAX_TTL_SECONDS,
  adminJwtAudience,
  adminJwtIssuer,
  DEFAULT_ADMIN_JWT_SECRET,
} from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRequest } from './admin-moderation.types';

type AdminJwtPayload = {
  sub?: unknown;
  jti?: unknown;
  iss?: unknown;
  aud?: unknown;
  iat?: unknown;
  exp?: unknown;
  amr?: unknown;
  scope?: unknown;
};

@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & AdminRequest>();
    const token = this.bearerToken(request);
    const issuer = adminJwtIssuer(this.config);
    const audience = adminJwtAudience(this.config);
    const secret = (this.config.get<string>('ADMIN_JWT_SECRET') ?? DEFAULT_ADMIN_JWT_SECRET).trim();
    if (!secret) throw new UnauthorizedException('Admin token verification is unavailable');

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        secret,
        algorithms: ['HS256'],
        issuer,
        audience,
        clockTolerance: 0,
      });
    } catch {
      throw new UnauthorizedException('Invalid admin token');
    }

    const now = Math.floor(Date.now() / 1000);
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const jti = typeof payload.jti === 'string' ? payload.jti : '';
    if (!/^admin:[1-9][0-9]{0,121}$/.test(sub)) {
      throw new UnauthorizedException('Admin token subject is invalid');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(jti)) {
      throw new UnauthorizedException('Admin token jti is invalid');
    }
    if (payload.iss !== issuer || payload.aud !== audience) {
      throw new UnauthorizedException('Admin token issuer or audience is invalid');
    }
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
      throw new UnauthorizedException('Admin token requires integer iat and exp claims');
    }
    const issuedAt = payload.iat as number;
    const expiresAt = payload.exp as number;
    if (issuedAt > now || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > ADMIN_JWT_MAX_TTL_SECONDS) {
      throw new UnauthorizedException('Admin token lifetime is invalid');
    }
    if (!Array.isArray(payload.amr) || !payload.amr.every((value) => typeof value === 'string') || !payload.amr.includes('mfa')) {
      throw new UnauthorizedException('Admin token requires MFA assurance');
    }
    const scopes = this.scopes(payload.scope);
    if (!scopes.length) throw new UnauthorizedException('Admin token requires scopes');

    await this.cleanupExpiredJtis();
    try {
      await this.prisma.adminJwtJti.create({
        data: { jti, actorId: sub, expiresAt: new Date(expiresAt * 1000) },
      });
    } catch (error) {
      if (this.isUniqueError(error)) throw new UnauthorizedException('Admin token has already been used');
      throw error;
    }

    request.admin = { id: sub, jti, scopes, issuedAt, expiresAt };
    return true;
  }

  private bearerToken(request: Request) {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') throw new UnauthorizedException('Admin bearer token is required');
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) throw new UnauthorizedException('Admin bearer token is required');
    return match[1];
  }

  private scopes(value: unknown) {
    if (typeof value !== 'string') throw new UnauthorizedException('Admin token scope claim is invalid');
    const scopes = [...new Set(value.split(' ').filter(Boolean))];
    if (!scopes.length || scopes.some((scope) => !/^[a-z][a-z0-9:-]{2,127}$/.test(scope))) {
      throw new UnauthorizedException('Admin token scope claim is invalid');
    }
    return scopes;
  }

  private isUniqueError(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: string }).code === 'P2002';
  }

  private async cleanupExpiredJtis() {
    const expired = await this.prisma.adminJwtJti.findMany({
      where: { expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: 100,
      select: { jti: true },
    });
    if (expired.length) {
      await this.prisma.adminJwtJti.deleteMany({
        where: { jti: { in: expired.map((row) => row.jti) } },
      });
    }
  }
}
