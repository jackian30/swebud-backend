import { BuddySessionVisibility } from '@prisma/client';
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
    expect(prisma.buddyRoomParticipant.deleteMany).toHaveBeenCalledWith({ where: { userId, roomId: { not: 'room-1' } } });
    expect(realtime.emitToUser).toHaveBeenCalledTimes(1);
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-2', 'buddy:room-joined', expect.objectContaining({
      roomId: 'room-1',
      session: expect.objectContaining({ userId, roomId: 'room-1' }),
    }));
  });

  it('does not emit a room joined event when the user is already active in that room', async () => {
    const realtime = { emitToUser: jest.fn() };
    configureJoinRoomMocks({ roomId: 'room-1', expiresAt: new Date(Date.now() + 60_000) });
    service = new BuddyService(prisma, moduleRef(realtime) as any);

    await service.joinRoom(userId, { roomId: 'room-1', latitude: 14.61, longitude: 121.03 });

    expect(prisma.buddySession.findMany).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('only removes expired room participants when the matching session delete wins', async () => {
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
    prisma.buddyRoom = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };

    await (service as any).cleanupExpiredBuddyData();

    expect(prisma.buddyRoomParticipant.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.buddyRoomParticipant.deleteMany).toHaveBeenCalledWith({ where: { roomId: 'room-1', userId: 'user-2' } });
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
  }

  function moduleRef(realtime = { emitToUser: jest.fn() }) {
    return { get: jest.fn().mockReturnValue(realtime) };
  }
});
