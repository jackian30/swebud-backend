import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AdminPrincipal = {
  id: string;
  jti: string;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
};

export type AdminMutationContext = {
  requestId: string;
  idempotencyKey: string;
};

export type AdminRequest = {
  admin?: AdminPrincipal;
  adminMutation?: AdminMutationContext;
};

export const CurrentAdmin = createParamDecorator((_data: unknown, context: ExecutionContext): AdminPrincipal => {
  return context.switchToHttp().getRequest<AdminRequest>().admin!;
});

export const CurrentAdminMutation = createParamDecorator((_data: unknown, context: ExecutionContext): AdminMutationContext => {
  return context.switchToHttp().getRequest<AdminRequest>().adminMutation!;
});
