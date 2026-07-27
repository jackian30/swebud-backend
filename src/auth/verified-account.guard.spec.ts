import { ForbiddenException } from '@nestjs/common';
import { AllowUnverifiedMutation } from './allow-unverified-mutation.decorator';
import { VerifiedAccountGuard } from './verified-account.guard';

class TestController {
  @AllowUnverifiedMutation('Account recovery remains available.')
  recovery() {}

  mutation() {}
}

function context(emailVerified?: boolean, method = 'POST', handler = TestController.prototype.mutation) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, user: { id: 'user-1', emailVerified } }),
    }),
    getHandler: () => handler,
    getClass: () => TestController,
  } as any;
}

describe('VerifiedAccountGuard', () => {
  const guard = new VerifiedAccountGuard();

  it('allows an email-verified account', () => {
    expect(guard.canActivate(context(true))).toBe(true);
  });

  it('rejects an unverified account without affecting authentication endpoints', () => {
    expect(() => guard.canActivate(context(false))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(false))).toThrow('Verify your email');
  });

  it('allows read-only requests and explicitly documented recovery mutations', () => {
    expect(guard.canActivate(context(false, 'GET'))).toBe(true);
    expect(guard.canActivate(context(false, 'POST', TestController.prototype.recovery))).toBe(true);
  });
});
