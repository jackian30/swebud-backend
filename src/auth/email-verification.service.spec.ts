import { BadRequestException } from '@nestjs/common';
import {
  EmailVerificationService,
  RESEND_VERIFICATION_JITTER_MS,
  RESEND_VERIFICATION_MIN_RESPONSE_MS,
  RESEND_VERIFICATION_RESPONSE,
} from './email-verification.service';

function createFixture() {
  const createdTokens: Array<Record<string, any>> = [];
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([{
      id: 'user-1',
      email: 'runner@example.com',
      displayName: 'Runner',
      emailVerifiedAt: null,
    }]),
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'runner@example.com',
        displayName: 'Runner',
        emailVerifiedAt: null,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'runner@example.com',
        displayName: 'Runner',
      }),
    },
    emailVerificationToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockImplementation(({ data }) => {
        createdTokens.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  prisma.$transaction = jest.fn((callback: (tx: typeof prisma) => unknown) => callback(prisma));
  const config = {
    get: jest.fn((key: string) => ({
      FRONTEND_ORIGIN: 'https://swebudd.example',
      EMAIL_VERIFICATION_TTL_SECONDS: '3600',
      EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: '60',
    })[key]),
  };
  const mail = {
    sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new EmailVerificationService(prisma, config as any, mail as any),
    prisma,
    mail,
    createdTokens,
  };
}

describe('EmailVerificationService', () => {
  it('stores only a hash, emails the raw token, and atomically verifies it once', async () => {
    const { service, prisma, mail, createdTokens } = createFixture();

    await expect(service.sendForNewAccount('user-1')).resolves.toBe(true);
    expect(createdTokens).toHaveLength(1);
    const verificationUrl = new URL(mail.sendEmailVerificationEmail.mock.calls[0][0].verificationUrl);
    const rawToken = verificationUrl.searchParams.get('token')!;
    const [, secret] = rawToken.split('.');
    expect(createdTokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createdTokens[0].tokenHash).not.toBe(secret);

    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: createdTokens[0].id,
      tokenHash: createdTokens[0].tokenHash,
      userId: 'user-1',
      expiresAt: createdTokens[0].expiresAt,
      usedAt: null,
    });

    await expect(service.verify(rawToken)).resolves.toEqual({ ok: true, emailVerified: true });
    expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: createdTokens[0].id,
        tokenHash: createdTokens[0].tokenHash,
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      }),
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        emailVerifiedAt: expect.any(Date),
        emailVerificationSentAt: null,
      },
      select: { id: true, email: true, displayName: true },
    });
  });

  it('derives the verification recipient only after locking the current user row', async () => {
    const { service, prisma, mail } = createFixture();
    let releaseLock!: (rows: unknown[]) => void;
    prisma.$queryRaw.mockImplementationOnce(() => new Promise((resolve) => {
      releaseLock = resolve;
    }));

    const sending = service.sendForUser('user-1', true);
    await Promise.resolve();
    releaseLock([{
      id: 'user-1',
      email: 'new@example.com',
      displayName: 'Runner',
      emailVerifiedAt: null,
    }]);

    await expect(sending).resolves.toBe(true);
    expect(mail.sendEmailVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new@example.com',
    }));
    expect(mail.sendEmailVerificationEmail).not.toHaveBeenCalledWith(expect.objectContaining({
      to: 'old@example.com',
    }));
  });

  it('does not mint a token when a resend lookup email no longer matches the locked account', async () => {
    const { service, prisma, mail } = createFixture();
    prisma.$queryRaw.mockResolvedValueOnce([{
      id: 'user-1',
      email: 'new@example.com',
      displayName: 'Runner',
      emailVerifiedAt: null,
    }]);

    await expect(service.sendForUser('user-1', false, 'old@example.com')).resolves.toBe(false);
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(mail.sendEmailVerificationEmail).not.toHaveBeenCalled();
  });

  it('returns one anti-enumeration response for missing and cooldown-limited accounts', async () => {
    const missing = createFixture();
    missing.prisma.user.findUnique.mockResolvedValue(null);
    await expect(missing.service.resend('missing@example.com')).resolves.toEqual(RESEND_VERIFICATION_RESPONSE);
    expect(missing.mail.sendEmailVerificationEmail).not.toHaveBeenCalled();

    const coolingDown = createFixture();
    coolingDown.prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-1' })
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'runner@example.com',
        displayName: 'Runner',
        emailVerifiedAt: null,
      });
    coolingDown.prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(coolingDown.service.resend('runner@example.com')).resolves.toEqual(RESEND_VERIFICATION_RESPONSE);
    expect(coolingDown.mail.sendEmailVerificationEmail).not.toHaveBeenCalled();

    await expect(coolingDown.service.resend(undefined)).resolves.toEqual(RESEND_VERIFICATION_RESPONSE);
  });

  it('holds missing and existing-account resend responses behind the same timing floor', async () => {
    jest.useFakeTimers();
    try {
      const missing = createFixture();
      missing.prisma.user.findUnique.mockResolvedValue(null);
      const existing = createFixture();

      let missingSettled = false;
      let existingSettled = false;
      const missingResponse = missing.service.resend('missing@example.com')
        .finally(() => { missingSettled = true; });
      const existingResponse = existing.service.resend('runner@example.com')
        .finally(() => { existingSettled = true; });

      await jest.advanceTimersByTimeAsync(RESEND_VERIFICATION_MIN_RESPONSE_MS - 1);
      expect(missingSettled).toBe(false);
      expect(existingSettled).toBe(false);

      await jest.advanceTimersByTimeAsync(RESEND_VERIFICATION_JITTER_MS + 1);
      await expect(Promise.all([missingResponse, existingResponse])).resolves.toEqual([
        RESEND_VERIFICATION_RESPONSE,
        RESEND_VERIFICATION_RESPONSE,
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the same invalid response for malformed, expired, and already-used tokens', async () => {
    const { service, prisma } = createFixture();
    await expect(service.verify('not-a-token')).rejects.toEqual(
      expect.objectContaining<Partial<BadRequestException>>({ message: 'Invalid or expired verification token' }),
    );

    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'a'.repeat(32),
      tokenHash: 'b'.repeat(64),
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    });
    await expect(service.verify(`${'a'.repeat(32)}.${'c'.repeat(64)}`))
      .rejects.toThrow('Invalid or expired verification token');
  });
});
