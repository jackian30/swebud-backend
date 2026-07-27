import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_SCOPES } from './admin-scopes.decorator';
import { AdminRequest } from './admin-moderation.types';

@Injectable()
export class AdminScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(ADMIN_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    const principal = context.switchToHttp().getRequest<AdminRequest>().admin;
    if (!principal) throw new ForbiddenException('Admin authentication is required');
    if (!required.length) {
      throw new ForbiddenException('Admin route scope policy is not configured');
    }
    const missing = required.filter((scope) => !principal.scopes.includes(scope));
    if (missing.length) throw new ForbiddenException(`Missing admin scope: ${missing.join(', ')}`);
    return true;
  }
}
