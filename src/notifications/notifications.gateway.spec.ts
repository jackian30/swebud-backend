import { NotificationsGateway } from './notifications.gateway';
import { BuddyRoomTypingDto } from './dto';

describe('NotificationsGateway authentication', () => {
  it('exposes a concrete room-typing payload for global ValidationPipe', () => {
    expect(Reflect.getMetadata('design:paramtypes', NotificationsGateway.prototype, 'buddyRoomTyping')?.[1]).toBe(BuddyRoomTypingDto);
  });

  it('disconnects a banned account even when its Socket.IO session is otherwise valid', async () => {
    const presence = { trackConnection: jest.fn(), trackDisconnection: jest.fn() };
    const prisma = {
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          user: { moderationStatus: 'banned', bannedAt: new Date(), bannedUntil: null },
        }),
      },
    };
    const gateway = new NotificationsGateway(
      { verifyAsync: jest.fn().mockResolvedValue({ sub: 'banned-user', sid: 'session-1', exp: Math.floor(Date.now() / 1000) + 900 }) } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      presence as any,
    );
    const client = {
      id: 'socket-1',
      data: {},
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
    expect(presence.trackConnection).not.toHaveBeenCalled();
  });

  it('disconnects an already-connected socket before accepting an event after revocation', async () => {
    const presence = { trackConnection: jest.fn(), trackDisconnection: jest.fn() };
    const prisma = {
      refreshToken: { findFirst: jest.fn().mockResolvedValue(null) },
      buddySession: { findFirst: jest.fn(), findMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    const gateway = new NotificationsGateway(
      { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', sid: 'revoked-session', exp: Math.floor(Date.now() / 1000) + 900 }) } as any,
      { get: jest.fn() } as any,
      prisma as any,
      presence as any,
    );
    const client = {
      id: 'socket-1',
      data: { userId: 'user-1' },
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: jest.fn(),
    } as any;

    await expect(gateway.buddyRoomTyping(client, { roomId: 'room-1' })).resolves.toBeNull();

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(prisma.buddySession.findFirst).not.toHaveBeenCalled();
  });

  it('disconnects a passive connected socket after its account becomes banned', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T07:00:00.000Z'));
    const activeUser = {
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      usernameFinalized: true,
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      legalConsentAt: new Date('2026-01-01T00:00:00.000Z'),
      dataConsentAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const prisma = {
      refreshToken: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'session-1', user: activeUser })
          .mockResolvedValueOnce({
            id: 'session-1',
            user: { ...activeUser, moderationStatus: 'banned', bannedAt: new Date() },
          }),
      },
    };
    const gateway = new NotificationsGateway(
      { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', sid: 'session-1', exp: Math.floor(Date.now() / 1000) + 900 }) } as any,
      { get: jest.fn() } as any,
      prisma as any,
      { trackConnection: jest.fn(), trackDisconnection: jest.fn() } as any,
    );
    const client = {
      id: 'notifications-passive-banned',
      data: {},
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    } as any;

    await gateway.handleConnection(client);
    await jest.advanceTimersByTimeAsync(30_000);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    jest.useRealTimers();
  });

  it('disconnects a passive connected socket when its access token expires', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T07:00:00.000Z'));
    const prisma = {
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          user: {
            moderationStatus: 'active',
            bannedAt: null,
            bannedUntil: null,
            usernameFinalized: true,
            dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
            legalConsentAt: new Date('2026-01-01T00:00:00.000Z'),
            dataConsentAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        }),
      },
    };
    const gateway = new NotificationsGateway(
      { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', sid: 'session-1', exp: Math.floor(Date.now() / 1000) + 1 }) } as any,
      { get: jest.fn() } as any,
      prisma as any,
      { trackConnection: jest.fn(), trackDisconnection: jest.fn() } as any,
    );
    const client = {
      id: 'notifications-passive-expired',
      data: {},
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    } as any;

    await gateway.handleConnection(client);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    jest.useRealTimers();
  });
});
