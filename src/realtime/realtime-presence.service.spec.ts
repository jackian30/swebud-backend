import { OFFLINE_BUDDY_SESSION_GRACE_MS, RealtimePresenceService } from './realtime-presence.service';

describe('RealtimePresenceService', () => {
  let service: RealtimePresenceService;
  let buddy: { stop: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    buddy = { stop: jest.fn().mockResolvedValue({ ok: true }) };
    service = new RealtimePresenceService(buddy as any);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('closes the buddy session after the user is offline for two minutes', async () => {
    service.trackConnection('user-1', 'chat:socket-1');
    service.trackDisconnection('user-1', 'chat:socket-1');

    await jest.advanceTimersByTimeAsync(OFFLINE_BUDDY_SESSION_GRACE_MS - 1);
    expect(buddy.stop).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(buddy.stop).toHaveBeenCalledWith('user-1');
  });

  it('keeps the buddy session open while any realtime connection remains', async () => {
    service.trackConnection('user-1', 'chat:socket-1');
    service.trackConnection('user-1', 'notifications:socket-2');
    service.trackDisconnection('user-1', 'chat:socket-1');

    await jest.advanceTimersByTimeAsync(OFFLINE_BUDDY_SESSION_GRACE_MS);
    expect(buddy.stop).not.toHaveBeenCalled();
  });

  it('cancels the offline close when the user reconnects before the grace period ends', async () => {
    service.trackConnection('user-1', 'chat:socket-1');
    service.trackDisconnection('user-1', 'chat:socket-1');
    await jest.advanceTimersByTimeAsync(OFFLINE_BUDDY_SESSION_GRACE_MS - 1);

    service.trackConnection('user-1', 'notifications:socket-2');
    await jest.advanceTimersByTimeAsync(1);

    expect(buddy.stop).not.toHaveBeenCalled();
  });
});
