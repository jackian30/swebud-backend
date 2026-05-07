import { AuthService } from './auth.service';

describe('AuthService password reset URLs', () => {
  it('uses the first allowed frontend origin when multiple CORS origins are configured', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'token-1' }),
      },
    };
    const mail = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((key: string) => key === 'FRONTEND_ORIGIN'
        ? 'http://localhost:9000,https://192.168.18.50:9443'
        : undefined),
    };
    const service = new AuthService(
      prisma as any,
      {} as any,
      config as any,
      mail as any,
      {} as any,
      {} as any,
    );

    await expect(service.forgotPassword(' USER@example.com ')).resolves.toEqual({ ok: true });

    expect(mail.sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      resetUrl: expect.stringMatching(/^http:\/\/localhost:9000\/auth\?mode=reset&token=/),
    }));
    expect(mail.sendPasswordResetEmail.mock.calls[0][0].resetUrl).not.toContain(',');
  });
});
