import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuthUser } from '../common/current-user.decorator';
import { ALLOW_PENDING_ONBOARDING } from './allow-pending-onboarding.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const authenticated = await super.canActivate(context);
    if (!authenticated) return false;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (request.user?.onboarded !== false) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_ONBOARDING, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    throw new ForbiddenException('Complete onboarding before using this endpoint');
  }
}
