import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../common/current-user.decorator';
import { ALLOW_UNVERIFIED_MUTATION } from './allow-unverified-mutation.decorator';

@Injectable()
export class VerifiedAccountGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ method?: string; user?: AuthUser }>();
    if (request.method && ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
    const rationale = Reflect.getMetadata(ALLOW_UNVERIFIED_MUTATION, context.getHandler())
      ?? Reflect.getMetadata(ALLOW_UNVERIFIED_MUTATION, context.getClass());
    if (rationale) return true;
    if (request.user?.emailVerified) return true;
    throw new ForbiddenException('Verify your email before using this feature');
  }
}
