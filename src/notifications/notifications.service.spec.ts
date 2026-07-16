import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService response privacy', () => {
  const createdAt = new Date('2026-07-16T00:00:00.000Z');
  const rawNotification = {
    id: 'notification-1',
    userId: 'recipient-private-id',
    actorId: 'actor-private-id',
    actorIds: ['actor-private-id'],
    type: NotificationType.salute,
    entityId: 'post-1',
    message: 'Alice saluted your post.',
    readAt: null,
    createdAt,
    title: 'phantom title',
    targetPath: '/phantom',
    actor: {
      id: 'actor-private-id',
      displayName: 'Alice',
      username: 'alice',
      profileImageUrl: null,
    },
  };

  it('selects and returns only documented notification fields', async () => {
    const prisma = {
      notification: { findMany: jest.fn().mockResolvedValue([rawNotification]) },
    };
    const service = new NotificationsService(prisma as any, { emitToUser: jest.fn() } as any);

    const notifications = await service.list('recipient-private-id');

    const query = prisma.notification.findMany.mock.calls[0][0];
    expect(query).not.toHaveProperty('include');
    expect(query.select).toEqual({
      id: true,
      type: true,
      entityId: true,
      actorIds: true,
      message: true,
      readAt: true,
      createdAt: true,
      actor: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
    });
    expect(notifications).toEqual([{
      id: 'notification-1',
      type: NotificationType.salute,
      entityId: 'post-1',
      actorIds: ['actor-private-id'],
      message: 'Alice saluted your post.',
      readAt: null,
      createdAt,
      actor: rawNotification.actor,
    }]);
    expect(notifications[0]).not.toHaveProperty('userId');
    expect(notifications[0]).not.toHaveProperty('actorId');
    expect(notifications[0]).not.toHaveProperty('title');
    expect(notifications[0]).not.toHaveProperty('targetPath');
  });

  it('emits the same explicit projection returned by create', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(rawNotification.actor) },
      notification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(rawNotification),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const gateway = { emitToUser: jest.fn() };
    const service = new NotificationsService(prisma as any, gateway as any);

    const notification = await service.create({
      userId: 'recipient-private-id',
      actorId: 'actor-private-id',
      type: NotificationType.salute,
      entityId: 'post-1',
      message: 'saluted your post',
    });

    expect(notification).not.toHaveProperty('userId');
    expect(notification).not.toHaveProperty('actorId');
    expect(gateway.emitToUser).toHaveBeenCalledWith('recipient-private-id', 'notification:new', notification);
  });
});
