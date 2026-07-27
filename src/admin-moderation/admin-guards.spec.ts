import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminMutationGuard } from './admin-mutation.guard';
import { ADMIN_SCOPES } from './admin-scopes.decorator';
import { AdminScopesGuard } from './admin-scopes.guard';

describe('admin moderation authorization guards', () => {
  function context(request: Record<string, unknown>, handler = () => undefined) {
    return {
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
  }

  it('requires UUID-v4 request IDs and bounded idempotency keys on mutations', () => {
    const guard = new AdminMutationGuard();
    const request = {
      headers: {
        'x-request-id': '123e4567-e89b-42d3-a456-426614174000',
        'idempotency-key': 'ban-user-0001',
      },
    };

    expect(guard.canActivate(context(request))).toBe(true);
    expect(request).toHaveProperty('adminMutation', {
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      idempotencyKey: 'ban-user-0001',
    });
  });

  it.each([
    [{ 'idempotency-key': 'valid-key' }, 'X-Request-ID'],
    [{ 'x-request-id': 'not-a-uuid', 'idempotency-key': 'valid-key' }, 'UUID v4'],
    [{ 'x-request-id': '123e4567-e89b-42d3-a456-426614174000', 'idempotency-key': 'short' }, '8-128'],
  ])('rejects invalid mutation headers', (headers, message) => {
    const guard = new AdminMutationGuard();
    expect(() => guard.canActivate(context({ headers }))).toThrow(message);
  });

  it('enforces every required granular scope', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ADMIN_SCOPES, ['moderation:reports:read', 'moderation:evidence:read'], handler);
    const guard = new AdminScopesGuard(new Reflector());

    expect(() => guard.canActivate(context({
      admin: { scopes: ['moderation:reports:read'] },
    }, handler))).toThrow(ForbiddenException);
    expect(guard.canActivate(context({
      admin: { scopes: ['moderation:reports:read', 'moderation:evidence:read'] },
    }, handler))).toBe(true);
  });

  it('fails closed when an admin route has no scope policy metadata', () => {
    const guard = new AdminScopesGuard(new Reflector());

    expect(() => guard.canActivate(context({
      admin: { scopes: ['moderation:reports:read'] },
    }))).toThrow('Admin route scope policy is not configured');
  });
});
