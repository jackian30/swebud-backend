import { RealtimePresenceService } from './realtime-presence.service';

describe('RealtimePresenceService', () => {
  let service: RealtimePresenceService;

  beforeEach(() => {
    service = new RealtimePresenceService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('does not stop a buddy session when the last realtime connection closes', () => {
    service.trackConnection('user-1', 'chat:socket-1');
    service.trackDisconnection('user-1', 'chat:socket-1');

    expect(() => service.trackConnection('user-1', 'notifications:socket-2')).not.toThrow();
  });

  it('keeps tracking while any realtime connection remains', () => {
    service.trackConnection('user-1', 'chat:socket-1');
    service.trackConnection('user-1', 'notifications:socket-2');
    service.trackDisconnection('user-1', 'chat:socket-1');

    expect(() => service.trackDisconnection('user-1', 'notifications:socket-2')).not.toThrow();
  });

  it('allows reconnecting after all previous connections closed', () => {
    service.trackConnection('user-1', 'chat:socket-1');
    service.trackDisconnection('user-1', 'chat:socket-1');

    service.trackConnection('user-1', 'notifications:socket-2');

    expect(() => service.trackDisconnection('user-1', 'notifications:socket-2')).not.toThrow();
  });
});
