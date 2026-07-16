import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllowPendingOnboarding } from './allow-pending-onboarding.decorator';
import { JwtAuthGuard } from './jwt.guard';

describe('JwtAuthGuard onboarding enforcement', () => {
  let passportCanActivate: jest.SpyInstance;

  beforeEach(() => {
    const passportGuardPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype);
    passportCanActivate = jest.spyOn(passportGuardPrototype, 'canActivate').mockResolvedValue(true);
  });

  afterEach(() => {
    passportCanActivate.mockRestore();
  });

  it('blocks pending users from authenticated domain endpoints', async () => {
    class PostsController { create() {} }
    const guard = new JwtAuthGuard(new Reflector());

    await expect(guard.canActivate(contextFor(
      PostsController,
      PostsController.prototype.create,
      { id: 'pending-user', onboarded: false },
    ))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows only explicitly marked onboarding bootstrap endpoints for pending users', async () => {
    class AuthController { completeOnboarding() {} }
    AllowPendingOnboarding()(
      AuthController.prototype,
      'completeOnboarding',
      Object.getOwnPropertyDescriptor(AuthController.prototype, 'completeOnboarding')!,
    );
    const guard = new JwtAuthGuard(new Reflector());

    await expect(guard.canActivate(contextFor(
      AuthController,
      AuthController.prototype.completeOnboarding,
      { id: 'pending-user', onboarded: false },
    ))).resolves.toBe(true);
  });

  it('allows completed users through normal authenticated endpoints', async () => {
    class FeedController { list() {} }
    const guard = new JwtAuthGuard(new Reflector());

    await expect(guard.canActivate(contextFor(
      FeedController,
      FeedController.prototype.list,
      { id: 'complete-user', onboarded: true },
    ))).resolves.toBe(true);
  });
});

function contextFor(controller: object, handler: () => void, user: Record<string, unknown>) {
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
