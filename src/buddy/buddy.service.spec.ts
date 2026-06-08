import { BuddyDiscoveryAudience, BuddyRoomParticipantRole, BuddySessionVisibility } from '@prisma/client';
import { BuddyService } from './buddy.service';

describe('BuddyService', () => {
  const userId = 'user-1';
  let prisma: any;
  let service: BuddyService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ username: 'fitmaster' }),
      },
      buddyRoom: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: 'room-1',
          ...data,
          group: null,
          creator: { id: userId, displayName: null, username: 'fitmaster', profileImageUrl: null },
          participants: [{ userId }],
          _count: { sessions: 0 },
          createdAt: new Date('2026-05-23T00:00:00.000Z'),
          updatedAt: new Date('2026-05-23T00:00:00.000Z'),
        })),
      },
      $transaction: jest.fn((input) => Array.isArray(input) ? Promise.all(input) : input(prisma)),
    };
    service = new BuddyService(prisma, moduleRef() as any);
  });

  it('defaults a blank buddy session name to the creator username', async () => {
    const room = await service.createRoom(userId, { name: '   ', visibility: BuddySessionVisibility.private });

    expect(room.name).toBe("@fitmaster's session");
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: userId }, select: { username: true } });
    expect(prisma.buddyRoom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "@fitmaster's session" }),
    }));
  });

  it('keeps a provided buddy session name after trimming whitespace', async () => {
    const room = await service.createRoom(userId, { name: '  Sunday run  ', visibility: BuddySessionVisibility.private });

    expect(room.name).toBe('Sunday run');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.buddyRoom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Sunday run' }),
    }));
  });

  it('emits a socket event to active participants when a user newly joins a room', async () => {
    const realtime = { emitToUser: jest.fn() };
    configureJoinRoomMocks(null);
    service = new BuddyService(prisma, moduleRef(realtime) as any);

    const session = await service.joinRoom(userId, { roomId: 'room-1', latitude: 14.61, longitude: 121.03 });

    expect(session.roomId).toBe('room-1');
    expect(prisma.buddySession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        roomId: 'room-1',
        userId: { not: userId },
        expiresAt: { gt: expect.any(Date) },
      }),
      select: { userId: true },
    }));
    expect(prisma.buddyRoomParticipant.deleteMany).not.toHaveBeenCalled();
    expect(prisma.buddySessionMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ roomId: 'room-1', senderId: userId, kind: 'joined' }),
    }));
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:room-message', expect.objectContaining({
      roomId: 'room-1',
      message: expect.objectContaining({ kind: 'joined', senderId: userId }),
    }));
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:room-joined', expect.objectContaining({
      roomId: 'room-1',
      session: expect.objectContaining({ userId, roomId: 'room-1' }),
    }));
  });

  it('emits a room location update instead of joined when the user is already active in that room', async () => {
    const realtime = { emitToUser: jest.fn() };
    configureJoinRoomMocks({ roomId: 'room-1', expiresAt: new Date(Date.now() + 60_000) });
    service = new BuddyService(prisma, moduleRef(realtime) as any);

    await service.joinRoom(userId, { roomId: 'room-1', latitude: 14.61, longitude: 121.03 });

    expect(prisma.buddySessionMessage.create).not.toHaveBeenCalled();
    expect(prisma.buddySession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        roomId: 'room-1',
        userId: { not: userId },
        expiresAt: { gt: expect.any(Date) },
      }),
      select: { userId: true },
    }));
    expect(realtime.emitToUser).not.toHaveBeenCalledWith(
      'user-2',
      'buddy:room-joined',
      expect.anything(),
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:room-location-updated', expect.objectContaining({
      roomId: 'room-1',
      userId,
      latitude: 14.61,
      longitude: 121.03,
      session: expect.objectContaining({ userId, roomId: 'room-1', latitude: 14.61, longitude: 121.03 }),
    }));
  });

  it('emits a socket event to active participants when a user leaves a room', async () => {
    const realtime = { emitToUser: jest.fn() };
    prisma.user.findUnique = jest.fn().mockResolvedValue({ id: userId, displayName: 'Fit Master', username: 'fitmaster', profileImageUrl: null });
    prisma.buddySession = {
      findUnique: jest.fn().mockResolvedValue({ roomId: 'room-1' }),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([{ userId: 'user-2' }]),
      count: jest.fn().mockResolvedValue(1),
    };
    prisma.buddySessionMessage = {
      create: jest.fn().mockResolvedValue({
        id: 'message-left',
        roomId: 'room-1',
        senderId: userId,
        kind: 'left',
        body: 'left',
        createdAt: new Date('2026-05-23T00:02:00.000Z'),
        sender: { id: userId, displayName: 'Fit Master', username: 'fitmaster', profileImageUrl: null },
      }),
    };
    prisma.buddyRoom.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    prisma.buddyRoom.delete = jest.fn().mockResolvedValue({});
    prisma.buddyRoomParticipant = {
      findMany: jest.fn().mockResolvedValue([{ userId: 'owner-2' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    service = new BuddyService(prisma, moduleRef(realtime) as any);

    await service.stop(userId);

    expect(prisma.buddyRoomParticipant.deleteMany).not.toHaveBeenCalled();
    expect(prisma.buddySessionMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ roomId: 'room-1', senderId: userId, kind: 'left' }),
    }));
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:room-message', expect.objectContaining({
      roomId: 'room-1',
      message: expect.objectContaining({ kind: 'left', senderId: userId }),
    }));
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:room-left', expect.objectContaining({
      roomId: 'room-1',
      userId,
      user: expect.objectContaining({ username: 'fitmaster' }),
    }));
    expect(prisma.buddyRoom.delete).not.toHaveBeenCalled();
  });

  it('stops room live presence and notifies participants when the app closes', async () => {
    const realtime = { emitToUser: jest.fn() };
    prisma.buddySession = {
      findUnique: jest.fn().mockResolvedValue({ roomId: 'room-1', latitude: 14.61, longitude: 121.03 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ userId: 'user-2' }]),
      count: jest.fn().mockResolvedValue(1),
    };
    prisma.buddySessionMessage = {
      create: jest.fn(),
    };
    prisma.buddyRoom.findFirst = jest.fn().mockResolvedValue(null);
    prisma.buddyRoomParticipant = {
      findMany: jest.fn().mockResolvedValue([{ userId: 'owner-2' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
    };
    service = new BuddyService(prisma, moduleRef(realtime) as any);

    await service.stopPresence(userId);

    expect(prisma.buddySession.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(prisma.buddyRoomParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId: 'room-1', userId, kickedAt: null },
      data: expect.objectContaining({ leftAt: expect.any(Date), lastActivityAt: expect.any(Date) }),
    }));
    expect(prisma.buddyRoomParticipant.deleteMany).not.toHaveBeenCalled();
    expect(prisma.buddySessionMessage.create).not.toHaveBeenCalled();
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:room-presence-stopped', expect.objectContaining({
      roomId: 'room-1',
      userId,
    }));
    expect(prisma.buddyRoom.delete).not.toHaveBeenCalled();
  });

  it('stops discovery presence when the app closes outside a room', async () => {
    const realtime = { emitToUser: jest.fn() };
    prisma.block = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.buddySession = {
      findUnique: jest.fn().mockResolvedValue({ roomId: null, latitude: 14.61, longitude: 121.03 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ userId: 'user-2', latitude: 14.62, longitude: 121.04 }]),
    };
    service = new BuddyService(prisma, moduleRef(realtime) as any);

    await service.stopPresence(userId);

    expect(prisma.buddySession.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:discovery-session-stopped', expect.objectContaining({
      userId,
    }));
  });

  it('closes a room when the last owner or admin exits deliberately', async () => {
    prisma.user.findUnique = jest.fn().mockResolvedValue({ id: userId, displayName: 'Fit Master', username: 'fitmaster', profileImageUrl: null });
    prisma.buddySession = {
      findUnique: jest.fn().mockResolvedValue({ roomId: 'room-1' }),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    prisma.buddySessionMessage = {
      create: jest.fn().mockResolvedValue({
        id: 'message-left',
        roomId: 'room-1',
        senderId: userId,
        kind: 'left',
        body: 'left',
        createdAt: new Date('2026-05-23T00:02:00.000Z'),
        sender: { id: userId, displayName: 'Fit Master', username: 'fitmaster', profileImageUrl: null },
      }),
    };
    prisma.buddyRoom.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    prisma.buddyRoom.delete = jest.fn().mockResolvedValue({});
    prisma.buddyRoomParticipant = {
      findMany: jest.fn().mockResolvedValue([{ userId, role: BuddyRoomParticipantRole.owner }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    await service.stop(userId);

    expect(prisma.buddySession.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        roomId: 'room-1',
        userId: { in: [userId] },
        expiresAt: { gt: expect.any(Date) },
      }),
    }));
    expect(prisma.buddyRoom.delete).toHaveBeenCalledWith({ where: { id: 'room-1' } });
  });

  it('notifies active participants when a room is stopped', async () => {
    const realtime = { emitToUser: jest.fn() };
    prisma.buddyRoom.findUnique = jest.fn().mockResolvedValue({
      id: 'room-1',
      creatorId: userId,
      participants: [
        { userId, role: BuddyRoomParticipantRole.owner, kickedAt: null },
        { userId: 'user-2', role: BuddyRoomParticipantRole.member, kickedAt: null },
      ],
    });
    prisma.buddyRoom.delete = jest.fn().mockResolvedValue({});
    prisma.buddyRoomParticipant = { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) };
    prisma.buddySession = {
      findMany: jest.fn().mockResolvedValue([{ userId }, { userId: 'user-2' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    service = new BuddyService(prisma, moduleRef(realtime) as any);

    await service.closeRoom(userId, 'room-1');

    expect(prisma.buddyRoom.delete).toHaveBeenCalledWith({ where: { id: 'room-1' } });
    expect(realtime.emitToUser).toHaveBeenCalledWith(userId, 'buddy:room-closed', expect.objectContaining({ roomId: 'room-1' }));
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:room-closed', expect.objectContaining({ roomId: 'room-1' }));
  });

  it('keeps expired room participant records so private members can return', async () => {
    prisma.buddySession = {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'user-2', roomId: 'room-1' },
        { userId: 'user-3', roomId: 'room-1' },
      ]),
      deleteMany: jest.fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 }),
    };
    prisma.buddyRoomParticipant = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
    prisma.buddyRoom = {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    await (service as any).cleanupExpiredBuddyData();

    expect(prisma.buddyRoomParticipant.deleteMany).not.toHaveBeenCalled();
  });

  it('returns discoverable Find Buddy sessions inside radius bounds', async () => {
    const now = new Date();
    prisma.block = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.buddyActivityOption = {
      findFirst: jest.fn().mockResolvedValue({ activity: 'running' }),
    };
    prisma.buddySession = {
      findUnique: jest.fn().mockResolvedValue({
        canSee: BuddyDiscoveryAudience.public,
        expiresAt: new Date(now.getTime() + 60_000),
      }),
      findMany: jest.fn().mockResolvedValue([
        createBuddySession('far-session', 'user-3', 14.61, 122.03, now),
        createBuddySession('near-session', 'user-2', 14.62, 121.04, now),
      ]),
    };

    const sessions = await service.discoverable(userId, { activity: ' running ', lat: 14.61, lng: 121.03, radiusKm: 5 });

    expect(prisma.buddySession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: { not: userId, notIn: [] },
        roomId: null,
        activity: 'running',
        expiresAt: { gt: expect.any(Date) },
        latitude: expect.objectContaining({ gte: expect.any(Number), lte: expect.any(Number) }),
        longitude: expect.objectContaining({ gte: expect.any(Number), lte: expect.any(Number) }),
      }),
      take: 250,
    }));
    expect(sessions.map((session) => session.id)).toEqual(['near-session']);
    expect(sessions[0]?.user).toEqual({
      id: 'user-2',
      displayName: null,
      username: 'user-2',
      profileImageUrl: null,
      age: null,
    });
    expect(sessions[0]?.user).not.toHaveProperty('activityPersonas');
    expect(prisma.buddySession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            profileImageUrl: true,
            dateOfBirth: true,
          },
        },
      },
    }));
  });

  it('rejects discoverable Find Buddy sessions without an explicit radius', async () => {
    prisma.buddyActivityOption = {
      findFirst: jest.fn().mockResolvedValue(null),
    };

    await expect(service.discoverable(userId, { lat: 14.61, lng: 121.03 } as any))
      .rejects.toThrow('radiusKm is required for buddy discovery.');
  });

  it('returns lean buddy room summaries for session lists', async () => {
    const now = new Date('2026-05-23T00:00:00.000Z');
    prisma.buddyRoom.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'room-1',
        name: 'Sunday run',
        scope: 'public',
        visibility: BuddySessionVisibility.private,
        code: 'ABC123',
        groupId: null,
        group: null,
        creatorId: userId,
        activity: 'running',
        subActivity: null,
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        participants: [{ userId, role: BuddyRoomParticipantRole.owner, leftAt: null, kickedAt: null }],
        sessions: [{ id: 'session-1' }],
        _count: { sessions: 1 },
      }]);

    const rooms = await service.rooms(userId);

    expect(rooms[0]).toEqual(expect.objectContaining({
      id: 'room-1',
      name: 'Sunday run',
      participantCount: 1,
      code: 'ABC123',
    }));
    expect(rooms[0]).not.toHaveProperty('participants');
    expect(rooms[0]).not.toHaveProperty('activeSessions');
    expect(rooms[0]).not.toHaveProperty('sessions');
    expect(prisma.buddyRoom.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      include: expect.not.objectContaining({
        sessions: expect.anything(),
      }),
    }));
  });

  function configureJoinRoomMocks(previousSession: { roomId: string | null; expiresAt: Date } | null) {
    const room = {
      id: 'room-1',
      name: 'Sunday run',
      scope: 'public',
      visibility: BuddySessionVisibility.public,
      code: 'ABC123',
      groupId: null,
      group: null,
      creatorId: 'creator-1',
      creator: { id: 'creator-1', displayName: 'Creator', username: 'creator', profileImageUrl: null },
      participants: [{ userId: 'creator-1' }],
      activity: null,
      subActivity: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-05-23T00:00:00.000Z'),
      _count: { sessions: 1 },
    };
    prisma.buddyRoom.findFirst = jest.fn().mockResolvedValue(room);
    prisma.buddyRoom.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.buddyRoomParticipant = {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    prisma.buddySession = {
      findUnique: jest.fn().mockResolvedValue(previousSession),
      findMany: jest.fn().mockResolvedValue([{ userId: 'user-2' }]),
      upsert: jest.fn().mockImplementation(({ create, update }) => Promise.resolve({
        id: 'session-1',
        ...(previousSession ? update : create),
        userId,
        room,
        user: {
          id: userId,
          displayName: 'Fit Master',
          username: 'fitmaster',
          profileImageUrl: null,
          gender: null,
          dateOfBirth: null,
          activityPersonas: [],
        },
        updatedAt: new Date('2026-05-23T00:01:00.000Z'),
      })),
      count: jest.fn().mockResolvedValue(1),
    };
    prisma.buddySessionMessage = {
      create: jest.fn().mockResolvedValue({
        id: 'message-joined',
        roomId: 'room-1',
        senderId: userId,
        kind: 'joined',
        body: 'joined',
        createdAt: new Date('2026-05-23T00:02:00.000Z'),
        sender: { id: userId, displayName: 'Fit Master', username: 'fitmaster', profileImageUrl: null },
      }),
    };
  }

  function moduleRef(realtime = { emitToUser: jest.fn() }) {
    return { get: jest.fn().mockReturnValue(realtime) };
  }

  function createBuddySession(id: string, targetUserId: string, latitude: number, longitude: number, now: Date) {
    return {
      id,
      userId: targetUserId,
      roomId: null,
      room: null,
      activity: 'running',
      subActivity: null,
      note: null,
      visibleTo: BuddyDiscoveryAudience.public,
      canSee: BuddyDiscoveryAudience.public,
      latitude,
      longitude,
      expiresAt: new Date(now.getTime() + 60_000),
      updatedAt: now,
      user: {
        id: targetUserId,
        displayName: null,
        username: targetUserId,
        profileImageUrl: null,
        gender: null,
        dateOfBirth: null,
        activityPersonas: [],
      },
    };
  }
});
