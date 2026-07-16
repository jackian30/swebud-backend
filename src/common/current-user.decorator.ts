import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthUser = {
  id: string;
  sessionId?: string;
  loginSessionId?: string | null;
  onboarded?: boolean;
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
