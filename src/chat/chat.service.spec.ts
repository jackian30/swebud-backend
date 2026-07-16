import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
      directChatMute: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
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
        findFirst: jest.fn().mockResolvedValue(null),
        findFirstOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'request-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
        findMany: jest.fn().mockResolvedValue([]),
      },
      buddyGroupChatMember: {
        findUnique: jest.fn().mockResolvedValue({ userId }),
      },
      buddyGroupChat: {
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
      },
      buddyGroupChatMute: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      buddyGroupChatPin: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      groupMember: {
        findUnique: jest.fn(),
      },
      groupChatChannel: {
        findUniqueOrThrow: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0n }]),
      $transaction: jest.fn().mockImplementation((input) => typeof input === 'function' ? input(prisma) : Promise.all(input)),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    service = new ChatService(prisma, notifications);
  });

  it('blocks direct messages when users are not mutual', async () => {
    prisma.follow.findUnique.mockResolvedValue(null);

    await expect(service.send(userId, { recipientId: peerId, body: 'hello' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('sends direct messages after either user accepts a message request', async () => {
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.messageRequest.findFirst.mockResolvedValue({ id: 'request-1' });

    await service.send(userId, { recipientId: peerId, body: ' hello ' });

    expect(prisma.messageRequest.findFirst).toHaveBeenCalledWith({
      where: {
        status: 'accepted',
        OR: [
          { senderId: userId, recipientId: peerId },
          { senderId: peerId, recipientId: userId },
        ],
      },
      select: { id: true },
    });
    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        senderId: userId,
        recipientId: peerId,
        body: 'hello',
      }),
    }));
  });

  it('sends instead of creating another request after a message request was accepted', async () => {
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.messageRequest.findFirst.mockResolvedValue({ id: 'request-1' });

    await service.request(userId, { recipientId: peerId, body: 'still there?' });

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        senderId: userId,
        recipientId: peerId,
        body: 'still there?',
      }),
    }));
    expect(prisma.messageRequest.create).not.toHaveBeenCalled();
  });

  it('coalesces an existing pending request for the same user pair', async () => {
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.messageRequest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'pending-1', senderId: userId, recipientId: peerId, status: 'pending' });

    await expect(service.request(userId, { recipientId: peerId, body: 'again' }))
      .resolves.toEqual(expect.objectContaining({ id: 'pending-1' }));
    expect(prisma.messageRequest.create).not.toHaveBeenCalled();
  });

  it('accepts a message request exactly once through an atomic pending-state claim', async () => {
    const pending = {
      id: 'request-1',
      senderId: peerId,
      recipientId: userId,
      body: 'hello',
      referenceType: null,
      referenceId: null,
      referenceMediaUrl: null,
      referenceText: null,
      referenceAuthorName: null,
    };
    prisma.messageRequest.findUniqueOrThrow
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: 'accepted' });

    await expect(service.accept(userId, 'request-1')).resolves.toEqual(expect.objectContaining({ status: 'accepted' }));

    expect(prisma.messageRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', recipientId: userId, status: 'pending' },
      data: { status: 'accepted' },
    });
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a duplicate message when an accepted request is retried concurrently', async () => {
    prisma.messageRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'request-1',
      senderId: peerId,
      recipientId: userId,
      body: 'hello',
      referenceType: null,
      referenceId: null,
      referenceMediaUrl: null,
      referenceText: null,
      referenceAuthorName: null,
    });
    prisma.messageRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.accept(userId, 'request-1')).rejects.toThrow('no longer pending');

    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('declines only a request that is still pending', async () => {
    prisma.messageRequest.findUniqueOrThrow.mockResolvedValue({ id: 'request-1', senderId: peerId, recipientId: userId, status: 'accepted' });
    prisma.messageRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.decline(userId, 'request-1')).rejects.toThrow('no longer pending');
    expect(prisma.messageRequest.update).not.toHaveBeenCalled();
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

  it('derives direct-message reply previews from the authorized server record', async () => {
    prisma.follow.findUnique.mockResolvedValue({ createdAt: new Date() });
    prisma.message.findUniqueOrThrow.mockResolvedValue({
      id: 'message-original',
      senderId: peerId,
      recipientId: userId,
      groupId: null,
      buddyGroupChatId: null,
      body: 'Authoritative text',
      deletedAt: null,
      sender: { displayName: 'Real Author', username: 'real-author' },
    });

    await service.send(userId, {
      recipientId: peerId,
      body: 'reply',
      referenceType: 'message',
      referenceId: 'message-original',
      referenceText: 'Spoofed text',
      referenceAuthorName: 'Spoofed author',
    });

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        referenceType: 'message',
        referenceId: 'message-original',
        referenceText: 'Authoritative text',
        referenceAuthorName: 'Real Author',
      }),
    }));
  });

  it('keeps message-request and conversation GET paths read-only', async () => {
    await service.requests(userId);
    await service.conversations(userId);

    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.messageRequest.update).not.toHaveBeenCalled();
    expect(prisma.messageRequest.updateMany).not.toHaveBeenCalled();
  });

  it('marks buddy-group messages read only through the explicit mutation', async () => {
    prisma.message.findMany.mockResolvedValue([]);
    prisma.buddyGroupChatReadState.upsert.mockResolvedValue({ lastReadAt: new Date('2026-07-16T07:00:00.000Z') });

    await service.buddyGroupMessages(userId, 'buddy-group-1');
    expect(prisma.buddyGroupChatReadState.upsert).not.toHaveBeenCalled();

    await expect(service.markBuddyGroupRead(userId, 'buddy-group-1')).resolves.toEqual(expect.objectContaining({
      ok: true,
      buddyGroupChatId: 'buddy-group-1',
      userId,
    }));
    expect(prisma.buddyGroupChatReadState.upsert).toHaveBeenCalledTimes(1);
  });

  it('filters hidden messages and blocked senders from buddy-group summaries', async () => {
    const visibleMessageWhere = {
      hiddenBy: { none: { userId } },
      sender: {
        blocksSent: { none: { blockedId: userId } },
        blocksReceived: { none: { blockerId: userId } },
      },
    };
    prisma.buddyGroupChat.findUniqueOrThrow.mockResolvedValue({
      id: 'buddy-group-1',
      members: [],
      messages: [],
      _count: { members: 1, messages: 2 },
    });

    await service.buddyGroupChats(userId);
    await service.buddyGroupChat(userId, 'buddy-group-1');

    expect(prisma.buddyGroupChat.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        messages: expect.objectContaining({ where: visibleMessageWhere, take: 1 }),
        _count: { select: { members: true, messages: { where: visibleMessageWhere } } },
      }),
    }));
    expect(prisma.buddyGroupChat.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        messages: expect.objectContaining({ where: visibleMessageWhere, take: 1 }),
        _count: { select: { members: true, messages: { where: visibleMessageWhere } } },
      }),
    }));
  });

  it('returns an exact buddy-group chat projection without membership persistence fields', async () => {
    const createdAt = new Date('2026-07-16T09:00:00.000Z');
    const updatedAt = new Date('2026-07-16T10:00:00.000Z');
    prisma.buddyGroupChat.findUniqueOrThrow.mockResolvedValue({
      id: 'buddy-group-1',
      creatorId: userId,
      name: 'Run buddies',
      description: null,
      createdAt,
      updatedAt,
      members: [{
        buddyGroupChatId: 'buddy-group-1',
        userId,
        addedById: 'admin-1',
        joinedAt: createdAt,
        user: { id: userId, displayName: null, username: 'runner', profileImageUrl: null },
      }],
      messages: [],
      _count: { members: 1, messages: 0 },
    });

    const response = await service.buddyGroupChat(userId, 'buddy-group-1');

    expect(response).toEqual({
      id: 'buddy-group-1',
      creatorId: userId,
      name: 'Run buddies',
      description: null,
      createdAt,
      updatedAt,
      members: [{
        userId,
        joinedAt: createdAt,
        user: { id: userId, displayName: null, username: 'runner', profileImageUrl: null },
      }],
      lastMessage: null,
      _count: { members: 1, messages: 0 },
      muted: false,
      pinned: false,
    });
  });

  it('normalizes message reactions and group read receipts to their public contract', async () => {
    const createdAt = new Date('2026-07-16T09:00:00.000Z');
    const lastReadAt = new Date('2026-07-16T09:05:00.000Z');
    prisma.message.findUniqueOrThrow
      .mockResolvedValueOnce({ senderId: peerId, recipientId: null, groupId: null, channelId: null, buddyGroupChatId: 'buddy-group-1' })
      .mockResolvedValueOnce({
        id: 'message-1',
        senderId: peerId,
        recipientId: null,
        groupId: null,
        channelId: null,
        buddyGroupChatId: 'buddy-group-1',
        body: 'hello',
        createdAt,
        readAt: null,
        reactions: [{ id: 'reaction-1', messageId: 'message-1', userId, emoji: '👍', createdAt }],
        pinnedBy: [],
      });
    prisma.buddyGroupChatReadState.findMany.mockResolvedValue([{
      userId,
      buddyGroupChatId: 'buddy-group-1',
      lastReadAt,
      user: { id: userId, displayName: null, username: 'runner', profileImageUrl: null },
    }]);

    const response = await service.messageInfo(userId, 'message-1');

    expect(response.message.reactions).toEqual([{ userId, emoji: '👍' }]);
    expect(response.message).not.toHaveProperty('pinnedBy');
    expect(response.readBy).toEqual([{
      userId,
      lastReadAt,
      user: { id: userId, displayName: null, username: 'runner', profileImageUrl: null },
    }]);
  });

  it('excludes blocked senders from total and per-room buddy-group unread queries', async () => {
    await service.unreadCount(userId);
    await service.buddyGroupChats(userId);

    const buddyGroupQueries = prisma.$queryRaw.mock.calls
      .map(([query]: [{ strings?: readonly string[] }]) => query.strings?.join(' ') ?? String(query))
      .filter((query: string) => query.includes('buddy_group_chat_members'));

    expect(buddyGroupQueries).toHaveLength(2);
    for (const query of buddyGroupQueries) {
      expect(query).toContain('FROM "blocks" AS block');
      expect(query).toContain('block."blocker_id"');
      expect(query).toContain('block."blocked_id"');
      expect(query).toContain('message."sender_id"');
    }
  });

  it('returns conversation summaries with unread counts and last messages', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'm2' }, { id: 'm1' }]);
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
      where: {
        groupId: null,
        senderId: { in: ['peer-1', 'peer-2'] },
        recipientId: userId,
        readAt: null,
        hiddenBy: { none: { userId } },
      },
      _count: { _all: true },
    });
    expect(prisma.message.count).not.toHaveBeenCalled();
  });

  it('uses direct message participant identity when a chat has no mutual-follow summary', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'm1' }]);
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
        hiddenBy: { none: { userId } },
        sender: {
          blocksSent: { none: { blockedId: userId } },
          blocksReceived: { none: { blockerId: userId } },
        },
      },
    });
  });

  it('rejects empty buddy-group chat names and messages after trimming', async () => {
    await expect(service.createBuddyGroupChat(userId, { name: '   ', participantIds: [peerId] }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sendBuddyGroupMessage(userId, 'buddy-group-1', { body: '   ' }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('excludes blocked senders from buddy-group and group message search', async () => {
    prisma.block.findMany.mockResolvedValueOnce([{ blockerId: userId, blockedId: peerId }]);

    await service.searchMessages(userId, 'hello');

    expect(prisma.message.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ senderId: { notIn: [peerId] } }),
    }));
    expect(prisma.message.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({ senderId: { notIn: [peerId] } }),
    }));
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

  it('rejects a missing unreact emoji before a broad reaction delete can run', async () => {
    await expect(service.unreact(userId, 'message-1', undefined as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.messageReaction.deleteMany).not.toHaveBeenCalled();
    expect(prisma.message.findUniqueOrThrow).not.toHaveBeenCalled();
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
      select: { role: true },
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

  it('rejects message-id actions against a private channel the group member cannot access', async () => {
    prisma.message.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'message-1',
      senderId: peerId,
      recipientId: null,
      groupId: 'group-1',
      channelId: 'private-channel-1',
    });
    prisma.groupMember.findUnique.mockResolvedValueOnce({ role: 'member' });
    prisma.groupChatChannel.findUniqueOrThrow.mockResolvedValueOnce({
      groupId: 'group-1',
      visibility: 'private',
      allowedUsers: [],
    });

    await expect(service.react(userId, 'message-1', { emoji: '🔥' })).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.messageReaction.create).not.toHaveBeenCalled();
  });

  it('rejects new encrypted messages while retaining read compatibility for stored rows', async () => {
    prisma.follow.findUnique.mockResolvedValue({ createdAt: new Date() });

    await expect(service.send(userId, {
      recipientId: peerId,
      body: '[encrypted]',
      encrypted: true,
      ciphertext: 'public-id-derived-ciphertext',
      nonce: 'nonce',
    } as any)).rejects.toThrow('secure device keys');

    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('never stores or returns private chat key material', async () => {
    prisma.user.update.mockResolvedValue({ id: userId, chatPublicKey: 'public-key' });

    await expect(service.registerKey(userId, { publicKey: 'public-key' })).resolves.toEqual({
      id: userId,
      chatPublicKey: 'public-key',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { chatPublicKey: 'public-key' },
      select: { id: true, chatPublicKey: true },
    });
  });
});
