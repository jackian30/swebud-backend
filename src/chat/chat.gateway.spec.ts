import { ChatGateway } from './chat.gateway';
import { SendDirectMessageDto, TypingDto } from './dto';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let room: { emit: jest.Mock };
  let jwt: { verifyAsync: jest.Mock };
  let prisma: { refreshToken: { findFirst: jest.Mock } };
  let chat: { send: jest.Mock; assertDirectMessagingAllowed: jest.Mock };

  beforeEach(() => {
    jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'sender-1',
        sid: 'session-1',
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    };
    prisma = {
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
    chat = {
      send: jest.fn(),
      assertDirectMessagingAllowed: jest.fn().mockResolvedValue(undefined),
    };
    gateway = new ChatGateway(jwt as any, { get: jest.fn() } as any, chat as any, prisma as any, { trackConnection: jest.fn(), trackDisconnection: jest.fn() } as any);
    room = { emit: jest.fn() };
    gateway.server = { to: jest.fn().mockReturnValue(room) } as any;
  });

  it('exposes concrete websocket payload metadata for global ValidationPipe', () => {
    expect(Reflect.getMetadata('design:paramtypes', ChatGateway.prototype, 'send')?.[1]).toBe(SendDirectMessageDto);
    expect(Reflect.getMetadata('design:paramtypes', ChatGateway.prototype, 'typing')?.[1]).toBe(TypingDto);
  });

  it('emits typing events to the recipient room', async () => {
    const client = { id: 'socket-1', data: { userId: 'sender-1' }, handshake: { auth: { token: 'valid-token' }, headers: {} }, disconnect: jest.fn() } as any;

    const result = await gateway.typing(client, { recipientId: 'recipient-1' });

    expect(result).toEqual({ ok: true });
    expect(chat.assertDirectMessagingAllowed).toHaveBeenCalledWith('sender-1', 'recipient-1');
    expect(gateway.server.to).toHaveBeenCalledWith('user:recipient-1');
    expect(room.emit).toHaveBeenCalledWith('chat:typing', { senderId: 'sender-1' });
  });

  it('does not disclose typing activity to a recipient the sender cannot message', async () => {
    chat.assertDirectMessagingAllowed.mockRejectedValueOnce(new Error('Send a message request first.'));
    const client = { id: 'socket-1', data: { userId: 'sender-1' }, handshake: { auth: { token: 'valid-token' }, headers: {} }, disconnect: jest.fn() } as any;

    await expect(gateway.typing(client, { recipientId: 'recipient-1' })).rejects.toThrow('message request');

    expect(gateway.server.to).not.toHaveBeenCalled();
    expect(room.emit).not.toHaveBeenCalled();
  });

  it('ignores typing events without an authenticated sender', async () => {
    const client = { id: 'socket-1', data: {}, handshake: { auth: {}, headers: {} }, disconnect: jest.fn() } as any;

    const result = await gateway.typing(client, { recipientId: 'recipient-1' });

    expect(result).toBeNull();
    expect(gateway.server.to).not.toHaveBeenCalled();
  });

  it('rate limits excessive typing events from one socket', async () => {
    const client = { id: 'socket-1', data: { userId: 'sender-1' }, handshake: { auth: { token: 'valid-token' }, headers: {} }, disconnect: jest.fn() } as any;

    for (let index = 0; index < 90; index += 1) {
      await expect(gateway.typing(client, { recipientId: 'recipient-1' })).resolves.toEqual({ ok: true });
    }

    await expect(gateway.typing(client, { recipientId: 'recipient-1' })).resolves.toBeNull();
  });

  it('disconnects an already-connected socket when its session is revoked', async () => {
    prisma.refreshToken.findFirst.mockResolvedValueOnce(null);
    const client = {
      id: 'socket-1',
      data: { userId: 'sender-1' },
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: jest.fn(),
    } as any;

    await expect(gateway.typing(client, { recipientId: 'recipient-1' })).resolves.toBeNull();

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(gateway.server.to).not.toHaveBeenCalled();
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
    gateway = new ChatGateway(
      { verifyAsync: jest.fn().mockResolvedValue({ sub: 'banned-user', sid: 'session-1', exp: Math.floor(Date.now() / 1000) + 900 }) } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      { send: jest.fn() } as any,
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

  it('disconnects a passive connected socket after its session is revoked', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T07:00:00.000Z'));
    jwt.verifyAsync.mockResolvedValue({
      sub: 'sender-1',
      sid: 'session-1',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const client = {
      id: 'socket-passive-revoked',
      data: {},
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    } as any;

    await gateway.handleConnection(client);
    prisma.refreshToken.findFirst.mockResolvedValue(null);
    await jest.advanceTimersByTimeAsync(30_000);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    jest.useRealTimers();
  });

  it('disconnects a passive connected socket exactly when its access token expires', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T07:00:00.000Z'));
    jwt.verifyAsync.mockResolvedValue({
      sub: 'sender-1',
      sid: 'session-1',
      exp: Math.floor(Date.now() / 1000) + 1,
    });
    const client = {
      id: 'socket-passive-expired',
      data: {},
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    } as any;

    await gateway.handleConnection(client);
    await jest.advanceTimersByTimeAsync(999);
    expect(client.disconnect).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    jest.useRealTimers();
  });

  it('clears passive authentication timers when a socket disconnects normally', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T07:00:00.000Z'));
    jwt.verifyAsync.mockResolvedValue({
      sub: 'sender-1',
      sid: 'session-1',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const client = {
      id: 'socket-normal-disconnect',
      data: {},
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    } as any;

    await gateway.handleConnection(client);
    gateway.handleDisconnect(client);
    prisma.refreshToken.findFirst.mockResolvedValue(null);
    await jest.advanceTimersByTimeAsync(30_000);

    expect(client.disconnect).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
