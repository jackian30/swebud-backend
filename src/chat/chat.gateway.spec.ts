import { ChatGateway } from './chat.gateway';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let room: { emit: jest.Mock };

  beforeEach(() => {
    gateway = new ChatGateway({} as any, {} as any, { send: jest.fn() } as any, {} as any, { trackConnection: jest.fn(), trackDisconnection: jest.fn() } as any);
    room = { emit: jest.fn() };
    gateway.server = { to: jest.fn().mockReturnValue(room) } as any;
  });

  it('emits typing events to the recipient room', () => {
    const client = { id: 'socket-1', data: { userId: 'sender-1' } } as any;

    const result = gateway.typing(client, { recipientId: 'recipient-1' });

    expect(result).toEqual({ ok: true });
    expect(gateway.server.to).toHaveBeenCalledWith('user:recipient-1');
    expect(room.emit).toHaveBeenCalledWith('chat:typing', { senderId: 'sender-1' });
  });

  it('ignores typing events without an authenticated sender', () => {
    const client = { id: 'socket-1', data: {} } as any;

    const result = gateway.typing(client, { recipientId: 'recipient-1' });

    expect(result).toBeNull();
    expect(gateway.server.to).not.toHaveBeenCalled();
  });

  it('rate limits excessive typing events from one socket', () => {
    const client = { id: 'socket-1', data: { userId: 'sender-1' } } as any;

    for (let index = 0; index < 90; index += 1) {
      expect(gateway.typing(client, { recipientId: 'recipient-1' })).toEqual({ ok: true });
    }

    expect(gateway.typing(client, { recipientId: 'recipient-1' })).toBeNull();
  });
});
