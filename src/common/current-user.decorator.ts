import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthUser = { id: string; email: string; sessionId?: string; loginSessionId?: string | null };

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
