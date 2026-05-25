import { ForbiddenException } from '@nestjs/common';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  const userId = 'user-1';
  const peerId = 'peer-1';
  let prisma: any;
  let notifications: any;
  let service: ChatService;

  beforeEach(() => {
    prisma = {
      user: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      chatProfileOverride: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      follow: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      block: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      message: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'message-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'message-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
      },
      messageRequest: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'request-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'request-1', ...data })),
        findUniqueOrThrow: jest.fn(),
      },
      messageReaction: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      hiddenMessage: {
        upsert: jest.fn(),
      },
      buddyGroupChatReadState: {
        upsert: jest.fn(),
      },
      groupMember: {
        findUnique: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0n }]),
      $transaction: jest.fn().mockImplementation((operations) => Promise.all(operations)),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    service = new ChatService(prisma, notifications);
  });

  it('blocks direct messages when users are not mutual', async () => {
    prisma.follow.findUnique.mockResolvedValue(null);

    await expect(service.send(userId, { recipientId: peerId, body: 'hello' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('blocks direct messages when either user has blocked the other', async () => {
    prisma.block.findFirst.mockResolvedValue({ blockerId: peerId });
    prisma.follow.findUnique.mockResolvedValue({ createdAt: new Date() });

    await expect(service.send(userId, { recipientId: peerId, body: 'hello' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('blocks direct chat profile access when either user has blocked the other', async () => {
    prisma.block.findFirst.mockResolvedValue({ blockerId: peerId });

    await expect(service.buddyProfile(userId, peerId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('sends direct messages between mutual buddies', async () => {
    prisma.follow.findUnique.mockResolvedValue({ createdAt: new Date() });

    await service.send(userId, { recipientId: peerId, body: ' hello ' });

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        senderId: userId,
        recipientId: peerId,
        body: 'hello',
      }),
    }));
  });

  it('ignores client-supplied ActSnap reference context on generic direct messages', async () => {
    prisma.follow.findUnique.mockResolvedValue({ createdAt: new Date() });

    await service.send(userId, {
      recipientId: peerId,
      body: 'Nice snap',
      referenceType: 'actsnap',
      referenceId: 'actsnap-1',
      referenceMediaUrl: '/api/uploads/actsnaps/one.webp',
      referenceText: 'Beach day',
      referenceAuthorName: 'Topher',
    });

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        referenceType: 'actsnap',
        referenceId: 'actsnap-1',
      }),
    }));
  });

  it('persists trusted ActSnap reference context for validated ActSnap replies', async () => {
    prisma.follow.findUnique.mockResolvedValue({ createdAt: new Date() });

    await service.request(userId, {
      recipientId: peerId,
      body: 'Nice snap',
      referenceType: 'actsnap',
      referenceId: 'actsnap-1',
      referenceMediaUrl: '/api/uploads/actsnaps/one.webp',
      referenceText: 'Beach day',
      referenceAuthorName: 'Topher',
    }, true);

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        body: 'Nice snap',
        referenceType: 'actsnap',
        referenceId: 'actsnap-1',
        referenceMediaUrl: '/api/uploads/actsnaps/one.webp',
        referenceText: 'Beach day',
        referenceAuthorName: 'Topher',
      }),
    }));
  });

  it('auto-accepts mutual message requests before listing pending requests', async () => {
    prisma.messageRequest.findMany
      .mockResolvedValueOnce([
        {
          id: 'request-1',
          senderId: peerId,
          recipientId: userId,
          body: 'hey',
          referenceType: 'actsnap',
          referenceId: 'actsnap-1',
          referenceMediaUrl: '/api/uploads/actsnaps/one.webp',
          referenceText: 'Beach day',
          referenceAuthorName: 'Topher',
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.follow.findUnique.mockResolvedValue({ createdAt: new Date() });

    await service.requests(userId);

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        senderId: peerId,
        recipientId: userId,
        body: 'hey',
        referenceType: 'actsnap',
        referenceId: 'actsnap-1',
        referenceMediaUrl: '/api/uploads/actsnaps/one.webp',
        referenceText: 'Beach day',
        referenceAuthorName: 'Topher',
      },
    });
    expect(prisma.messageRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'request-1' },
      data: { status: 'accepted' },
    }));
  });

  it('returns conversation summaries with unread counts and last messages', async () => {
    prisma.follow.findMany.mockResolvedValue([
      { following: { id: 'peer-1', displayName: 'Peer One', username: 'peerone', profileImageUrl: null } },
      { following: { id: 'peer-2', displayName: 'Peer Two', username: 'peertwo', profileImageUrl: null } },
    ]);
    prisma.message.findMany.mockResolvedValue([
      { id: 'm2', senderId: 'peer-2', recipientId: userId, body: 'new', createdAt: new Date('2026-05-07T09:00:00Z') },
      { id: 'm1', senderId: userId, recipientId: 'peer-1', body: 'old', createdAt: new Date('2026-05-07T08:00:00Z') },
    ]);
    prisma.message.groupBy.mockResolvedValue([{ senderId: 'peer-2', _count: { _all: 3 } }]);

    const summaries = await service.conversations(userId);

    expect(summaries).toEqual([
      expect.objectContaining({ peer: expect.objectContaining({ id: 'peer-2' }), unreadCount: 3, lastMessage: expect.objectContaining({ id: 'm2' }) }),
      expect.objectContaining({ peer: expect.objectContaining({ id: 'peer-1' }), unreadCount: 0, lastMessage: expect.objectContaining({ id: 'm1' }) }),
    ]);
    expect(prisma.message.groupBy).toHaveBeenCalledWith({
      by: ['senderId'],
      where: { groupId: null, senderId: { in: ['peer-1', 'peer-2'] }, recipientId: userId, readAt: null },
      _count: { _all: true },
    });
    expect(prisma.message.count).not.toHaveBeenCalled();
  });

  it('uses direct message participant identity when a chat has no mutual-follow summary', async () => {
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.message.findMany.mockResolvedValue([
      {
        id: 'm1',
        senderId: userId,
        recipientId: peerId,
        body: 'hello',
        createdAt: new Date('2026-05-07T08:00:00Z'),
        sender: { id: userId, displayName: 'Me', username: 'me', profileImageUrl: null },
        recipient: { id: peerId, displayName: 'Peer One', username: 'peerone', profileImageUrl: null },
      },
    ]);
    prisma.message.count.mockResolvedValue(0);

    await expect(service.conversations(userId)).resolves.toEqual([
      expect.objectContaining({
        peer: expect.objectContaining({
          id: peerId,
          displayName: 'Peer One',
          username: 'peerone',
        }),
        lastMessage: expect.objectContaining({ id: 'm1' }),
      }),
    ]);
  });

  it('includes usernames in direct message relations for chat labels', async () => {
    prisma.follow.findUnique.mockResolvedValue({ createdAt: new Date() });

    await service.send(userId, { recipientId: peerId, body: 'hello' });

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        sender: { select: expect.objectContaining({ username: true }) },
        recipient: { select: expect.objectContaining({ username: true }) },
      }),
    }));
  });

  it('marks unread messages from the active peer as read and returns total unread count', async () => {
    prisma.message.count.mockResolvedValue(4);

    await expect(service.markRead(userId, peerId)).resolves.toEqual({ count: 4, readAt: expect.any(Date), readCount: 0 });

    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { senderId: peerId, recipientId: userId, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(prisma.message.count).toHaveBeenCalledWith({
      where: {
        recipientId: userId,
        readAt: null,
        sender: {
          blocksSent: { none: { blockedId: userId } },
          blocksReceived: { none: { blockerId: userId } },
        },
      },
    });
  });

  it('notifies the message sender when someone else reacts to their message', async () => {
    prisma.message.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'message-1',
        senderId: peerId,
        recipientId: userId,
        groupId: null,
      })
      .mockResolvedValueOnce({
        id: 'message-1',
        senderId: peerId,
        recipientId: userId,
        body: 'hello',
        reactions: [{ userId, emoji: '👍' }],
      });

    await service.react(userId, 'message-1', { emoji: '👍' });

    expect(notifications.create).toHaveBeenCalledWith({
      userId: peerId,
      actorId: userId,
      type: 'message_reaction',
      entityId: 'message-1',
      message: 'reacted to your message',
    });
  });

  it('does not notify when reacting to your own message', async () => {
    prisma.message.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'message-1',
        senderId: userId,
        recipientId: peerId,
        groupId: null,
      })
      .mockResolvedValueOnce({
        id: 'message-1',
        senderId: userId,
        recipientId: peerId,
        body: 'hello',
        reactions: [{ userId, emoji: '👍' }],
      });

    await service.react(userId, 'message-1', { emoji: '👍' });

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('supports group chat reactions and notifies the group message sender', async () => {
    prisma.message.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'message-1',
        senderId: peerId,
        recipientId: null,
        groupId: 'group-1',
      })
      .mockResolvedValueOnce({
        id: 'message-1',
        senderId: peerId,
        recipientId: null,
        groupId: 'group-1',
        body: 'group hello',
        reactions: [{ userId, emoji: '🔥' }],
      });
    prisma.groupMember.findUnique.mockResolvedValueOnce({ userId });

    await service.react(userId, 'message-1', { emoji: '🔥' });

    expect(prisma.groupMember.findUnique).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: 'group-1', userId } },
      select: { userId: true },
    });
    expect(notifications.create).toHaveBeenCalledWith({
      userId: peerId,
      actorId: userId,
      type: 'message_reaction',
      entityId: 'message-1',
      message: 'reacted to your message',
    });
  });

  it('deletes a message only for the current user', async () => {
    prisma.message.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'message-1',
      senderId: peerId,
      recipientId: userId,
      groupId: null,
    });

    await service.deleteForMe(userId, 'message-1');

    expect(prisma.hiddenMessage.upsert).toHaveBeenCalledWith({
      where: { messageId_userId: { messageId: 'message-1', userId } },
      create: { messageId: 'message-1', userId },
      update: {},
    });
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('unsends a message sent by the current user and clears private payload', async () => {
    prisma.message.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'message-1',
      senderId: userId,
      recipientId: peerId,
      groupId: null,
    });

    await service.unsendMessage(userId, 'message-1');

    expect(prisma.message.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'message-1' },
      data: expect.objectContaining({
        body: '',
        referenceType: null,
        referenceId: null,
        referenceMediaUrl: null,
        referenceText: null,
        referenceAuthorName: null,
        ciphertext: null,
        nonce: null,
        encrypted: false,
        deletedById: userId,
      }),
    }));
    expect(prisma.messageReaction.deleteMany).toHaveBeenCalledWith({ where: { messageId: 'message-1' } });
  });

  it('blocks unsending a message sent by someone else', async () => {
    prisma.message.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'message-1',
      senderId: peerId,
      recipientId: userId,
      groupId: null,
    });

    await expect(service.unsendMessage(userId, 'message-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('allows unsending a group message sent by the current user', async () => {
    prisma.message.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'message-1',
      senderId: userId,
      recipientId: null,
      groupId: 'group-1',
    });
    prisma.groupMember.findUnique.mockResolvedValueOnce({ userId });

    await service.unsendMessage(userId, 'message-1');

    expect(prisma.message.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'message-1' },
      data: expect.objectContaining({ body: '', deletedById: userId }),
    }));
  });
});
