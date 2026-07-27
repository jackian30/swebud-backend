import { ForbiddenException } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { GroupsService } from '../groups/groups.service';
import { PostsService } from '../posts/posts.service';

describe('quarantined content freeze', () => {
  it.each(['remove', 'update', 'pin', 'unpin'] as const)(
    'blocks a post author from %s by known ID',
    async (method) => {
      const prisma: any = {
        post: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'post-1',
            authorId: 'user-1',
            moderationStatus: 'quarantined',
            text: 'preserved evidence',
            images: [],
            taggedUsers: [],
          }),
          delete: jest.fn(),
          update: jest.fn(),
        },
        $transaction: jest.fn(),
      };
      const service = new PostsService(prisma, {} as any);

      const call = method === 'update'
        ? service.update('user-1', 'post-1', {})
        : service[method]('user-1', 'post-1');
      await expect(call).rejects.toThrow('Quarantined content can only be changed');
      expect(prisma.post.delete).not.toHaveBeenCalled();
      expect(prisma.post.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('blocks comment mutation inside a quarantined post before resolving the known comment ID', async () => {
    const prisma: any = {
      post: { findFirst: jest.fn().mockResolvedValue(null) },
      comment: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    };
    const service = new PostsService(prisma, {} as any);

    await expect(service.updateComment('user-1', 'post-1', 'comment-1', { body: 'tamper' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.comment.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('blocks group owners from hard-deleting quarantined group posts', async () => {
    const prisma: any = {
      post: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'post-1',
          authorId: 'user-1',
          groupId: 'group-1',
          moderationStatus: 'quarantined',
        }),
        delete: jest.fn(),
      },
      groupMember: { findFirst: jest.fn() },
    };
    const service = new GroupsService(prisma, {} as any);

    await expect(service.removePost('owner-1', 'group-1', 'post-1'))
      .rejects.toThrow('Quarantined content can only be changed');
    expect(prisma.groupMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.post.delete).not.toHaveBeenCalled();
  });

  it('resolves group-owner powers only through active groups', async () => {
    const prisma: any = {
      groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
      group: { update: jest.fn() },
    };
    const service = new GroupsService(prisma, {} as any);

    await expect(service.updateSettings('owner-1', 'group-1', { name: 'tamper' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.groupMember.findFirst).toHaveBeenCalledWith({
      where: { groupId: 'group-1', userId: 'owner-1', group: { moderationStatus: 'active' } },
      select: { role: true },
    });
    expect(prisma.group.update).not.toHaveBeenCalled();
  });

  it.each([
    ['react', (service: ChatService) => service.react('user-1', 'message-1', { emoji: '👍' })],
    ['unreact', (service: ChatService) => service.unreact('user-1', 'message-1', '👍')],
    ['pin', (service: ChatService) => service.setMessagePin('user-1', 'message-1', { pinned: true })],
    ['delete-for-me', (service: ChatService) => service.deleteForMe('user-1', 'message-1')],
    ['unsend', (service: ChatService) => service.unsendMessage('user-1', 'message-1')],
  ] as const)('blocks a participant from %s after message quarantine wins the row lock', async (_name, call) => {
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((work: (tx: any) => unknown) => work(prisma)),
      message: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      messageReaction: { create: jest.fn(), deleteMany: jest.fn() },
      pinnedMessage: { upsert: jest.fn(), deleteMany: jest.fn() },
      hiddenMessage: { upsert: jest.fn() },
    };
    const service = new ChatService(prisma, { create: jest.fn() } as any);

    await expect(call(service)).rejects.toThrow(
      'Quarantined messages can only be changed by an authorized administrator',
    );
    expect(prisma.message.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.message.update).not.toHaveBeenCalled();
    expect(prisma.messageReaction.create).not.toHaveBeenCalled();
    expect(prisma.messageReaction.deleteMany).not.toHaveBeenCalled();
    expect(prisma.pinnedMessage.upsert).not.toHaveBeenCalled();
    expect(prisma.pinnedMessage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.hiddenMessage.upsert).not.toHaveBeenCalled();
  });

  it('keeps abuse reporting available to an existing participant after quarantine', async () => {
    const prisma: any = {
      message: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          senderId: 'reported-user',
          recipientId: 'user-1',
          groupId: null,
          channelId: null,
          buddyGroupChatId: null,
          moderationStatus: 'quarantined',
        }),
      },
      messageReport: {
        upsert: jest.fn().mockResolvedValue({ id: 'report-1' }),
      },
    };
    const service = new ChatService(prisma, {} as any);

    await expect(service.reportMessage('user-1', 'message-1', { category: 'harassment' }))
      .resolves.toEqual({ ok: true });
    expect(prisma.message.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'message-1' },
    }));
    expect(prisma.messageReport.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { messageId_userId: { messageId: 'message-1', userId: 'user-1' } },
    }));
  });
});
