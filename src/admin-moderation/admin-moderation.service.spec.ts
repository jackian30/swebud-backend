import { ConflictException } from '@nestjs/common';
import {
  ModerationReportType,
  ReportAppealStatus,
  ReportCategory,
  ReportStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { AdminModerationService } from './admin-moderation.service';

const actor = {
  id: 'admin:reviewer-1',
  jti: 'admin-request-00000001',
  scopes: ['moderation:reports:read'],
  issuedAt: 100,
  expiresAt: 400,
};

function mutation(index: number) {
  return {
    requestId: `123e4567-e89b-42d3-a456-4266141740${String(index).padStart(2, '0')}`,
    idempotencyKey: `moderation-operation-${index}`,
  };
}

function postReport(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-27T12:00:00.000Z');
  return {
    id: '123e4567-e89b-42d3-a456-426614174111',
    postId: '123e4567-e89b-42d3-a456-426614174222',
    userId: '123e4567-e89b-42d3-a456-426614174333',
    reason: 'spam',
    category: 'spam',
    note: null,
    details: null,
    status: 'open',
    priority: 0,
    assignedReviewerId: null,
    assignedAt: null,
    slaDueAt: null,
    escalationLevel: 0,
    escalatedAt: null,
    escalatedById: null,
    escalationReason: null,
    reviewedAt: null,
    reviewedById: null,
    actionTaken: null,
    resolutionNote: null,
    createdAt: now,
    updatedAt: now,
    user: {
      id: '123e4567-e89b-42d3-a456-426614174333',
      displayName: 'Reporter',
      username: 'reporter',
      profileImageUrl: null,
    },
    post: {
      id: '123e4567-e89b-42d3-a456-426614174222',
      authorId: '123e4567-e89b-42d3-a456-426614174444',
      text: 'Reported post',
      moderationStatus: 'active',
      createdAt: now,
    },
    ...overrides,
  };
}

function mutationHarness(txOverrides: Record<string, unknown> = {}) {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked-row' }]),
    adminIdempotencyRecord: {
      create: jest.fn().mockResolvedValue({ id: 'idempotency-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    adminAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    adminOutboxEvent: { create: jest.fn().mockResolvedValue({}) },
    ...txOverrides,
  };
  const prisma: any = {
    adminIdempotencyRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { tx, prisma, service: new AdminModerationService(prisma) };
}

describe('AdminModerationService', () => {
  it('merges all four report queues and attaches bounded lifecycle summaries', async () => {
    const base = postReport();
    const groupBy = jest.fn().mockImplementation(({ by }: { by: string[] }) => (
      by[0] === 'status'
        ? [{ status: ReportStatus.open, _count: { _all: 1 } }]
        : [{ category: ReportCategory.spam, _count: { _all: 1 } }]
    ));
    const count = jest.fn().mockResolvedValue(1);
    const prisma: any = {
      postReport: { findMany: jest.fn().mockResolvedValue([base]), groupBy, count },
      userReport: {
        findMany: jest.fn().mockResolvedValue([{
          ...base,
          id: '123e4567-e89b-42d3-a456-426614174112',
          reporter: base.user,
          reported: {
            id: '123e4567-e89b-42d3-a456-426614174555',
            username: 'reported-user',
            displayName: null,
            profileImageUrl: null,
            moderationStatus: 'active',
            bannedAt: null,
            bannedUntil: null,
            banReason: null,
            createdAt: base.createdAt,
          },
        }]),
        groupBy,
        count,
      },
      groupReport: {
        findMany: jest.fn().mockResolvedValue([{
          ...base,
          id: '123e4567-e89b-42d3-a456-426614174113',
          group: {
            id: '123e4567-e89b-42d3-a456-426614174666',
            name: 'Reported Group',
            slug: 'reported-group',
            moderationStatus: 'active',
            createdAt: base.createdAt,
          },
        }]),
        groupBy,
        count,
      },
      messageReport: {
        findMany: jest.fn().mockResolvedValue([{
          ...base,
          id: '123e4567-e89b-42d3-a456-426614174114',
          reason: undefined,
          message: {
            id: '123e4567-e89b-42d3-a456-426614174777',
            senderId: '123e4567-e89b-42d3-a456-426614174444',
            recipientId: null,
            groupId: null,
            buddyGroupChatId: null,
            channelId: null,
            body: 'Reported message',
            deletedAt: null,
            moderationStatus: 'quarantined',
            quarantinedAt: base.createdAt,
            quarantinedById: actor.id,
            quarantineReason: 'Credible abuse',
            createdAt: base.createdAt,
          },
        }]),
        groupBy,
        count,
      },
      adminReportInternalNote: {
        groupBy: jest.fn().mockResolvedValue([{
          reportType: ModerationReportType.post,
          reportId: base.id,
          _count: { _all: 2 },
        }]),
      },
      adminReportAppeal: { findMany: jest.fn().mockResolvedValue([]) },
      adminReportEvidence: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AdminModerationService(prisma);

    const result = await service.reports({
      take: 10,
      status: ReportStatus.open,
      category: ReportCategory.spam,
      assignedReviewerId: 'admin:reviewer-1',
    });

    expect(new Set(result.items.map((item) => item.type))).toEqual(new Set(['post', 'user', 'group', 'message']));
    expect(result.summary).toEqual({
      open: 4,
      reviewing: 0,
      resolved: 0,
      dismissed: 0,
      total: 4,
      overdue: 4,
      byCategory: {
        spam: 4,
        harassment: 0,
        hate: 0,
        sexual_content: 0,
        violence: 0,
        self_harm: 0,
        scam: 0,
        privacy: 0,
        impersonation: 0,
        illegal_activity: 0,
        other: 0,
      },
    });
    expect(result.items.find((item) => item.type === 'post')).toEqual(expect.objectContaining({
      internalNoteCount: 2,
      appeals: [],
      evidenceRetention: [],
    }));
    expect(result.items.find((item) => item.type === 'message')?.target).toEqual(expect.objectContaining({
      type: 'message',
      moderationStatus: 'quarantined',
      quarantinedById: actor.id,
      quarantineReason: 'Credible abuse',
    }));
    for (const delegate of [prisma.postReport, prisma.userReport, prisma.groupReport, prisma.messageReport]) {
      expect(delegate.findMany).toHaveBeenCalledWith(expect.objectContaining({
        take: 11,
        where: {
          status: ReportStatus.open,
          category: ReportCategory.spam,
          assignedReviewerId: 'admin:reviewer-1',
        },
      }));
    }
    expect(groupBy).toHaveBeenCalledTimes(8);
    expect(count).toHaveBeenCalledTimes(4);
    expect(count).toHaveBeenCalledWith({
      where: {
        status: ReportStatus.open,
        category: ReportCategory.spam,
        assignedReviewerId: 'admin:reviewer-1',
        AND: [
          { slaDueAt: { lt: expect.any(Date) } },
          { status: { in: [ReportStatus.open, ReportStatus.reviewing] } },
        ],
      },
    });
    expect(groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: {
        category: ReportCategory.spam,
        assignedReviewerId: 'admin:reviewer-1',
      },
      _count: { _all: true },
    });
    expect(groupBy).toHaveBeenCalledWith({
      by: ['category'],
      where: {
        status: ReportStatus.open,
        assignedReviewerId: 'admin:reviewer-1',
      },
      _count: { _all: true },
    });
  });

  it('treats overdue=false as the exact complement of active past-due reports', () => {
    const service = new AdminModerationService({} as any);
    const now = new Date('2026-07-27T12:00:00.000Z');

    expect((service as any).reportWhere({
      status: ReportStatus.open,
      overdue: true,
    }, {}, now)).toEqual({
      status: ReportStatus.open,
      AND: [
        { slaDueAt: { lt: now } },
        { status: { in: [ReportStatus.open, ReportStatus.reviewing] } },
      ],
    });
    expect((service as any).reportWhere({
      status: ReportStatus.open,
      overdue: false,
    }, {}, now)).toEqual({
      status: ReportStatus.open,
      OR: [
        { slaDueAt: null },
        { slaDueAt: { gte: now } },
        { status: { notIn: [ReportStatus.open, ReportStatus.reviewing] } },
      ],
    });
  });

  it('serializes two admins updating one report so audit before/after snapshots form one history', async () => {
    let report: any = postReport();
    let lockAttempts = 0;
    let lockHeld = false;
    const lockWaiters: Array<() => void> = [];
    const audits: any[] = [];
    let signalFirstLock!: () => void;
    let signalSecondLock!: () => void;
    const firstLockAcquired = new Promise<void>((resolve) => {
      signalFirstLock = resolve;
    });
    const secondLockAttempted = new Promise<void>((resolve) => {
      signalSecondLock = resolve;
    });

    const acquireLock = async () => {
      if (!lockHeld) {
        lockHeld = true;
        return;
      }
      await new Promise<void>((resolve) => lockWaiters.push(resolve));
    };
    const releaseLock = () => {
      const next = lockWaiters.shift();
      if (next) next();
      else lockHeld = false;
    };
    const prisma: any = {
      adminIdempotencyRecord: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
        let ownsReportLock = false;
        const tx: any = {
          $queryRaw: jest.fn(async () => {
            lockAttempts += 1;
            if (lockAttempts === 2) signalSecondLock();
            await acquireLock();
            ownsReportLock = true;
            if (lockAttempts === 1) {
              signalFirstLock();
              await secondLockAttempted;
            }
            return [{ id: report.id }];
          }),
          adminIdempotencyRecord: {
            create: jest.fn().mockResolvedValue({ id: `claim-${lockAttempts + 1}` }),
            update: jest.fn().mockResolvedValue({}),
          },
          postReport: {
            findUnique: jest.fn(async () => report),
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
              report = { ...report, ...data, updatedAt: new Date() };
              return report;
            }),
          },
          adminAuditEvent: {
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
              audits.push(data);
              return data;
            }),
          },
          adminOutboxEvent: { create: jest.fn().mockResolvedValue({}) },
        };
        try {
          return await callback(tx);
        } finally {
          if (ownsReportLock) releaseLock();
        }
      }),
    };
    const service = new AdminModerationService(prisma);
    const secondActor = { ...actor, id: 'admin:reviewer-2', jti: 'admin-request-00000002' };

    const first = service.updateReport(
      actor,
      mutation(20),
      ModerationReportType.post,
      report.id,
      { status: ReportStatus.reviewing },
    );
    await firstLockAcquired;
    const second = service.updateReport(
      secondActor,
      mutation(21),
      ModerationReportType.post,
      report.id,
      { status: ReportStatus.resolved, resolutionNote: 'Policy violation confirmed' },
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: ReportStatus.reviewing }),
      expect.objectContaining({ status: ReportStatus.resolved }),
    ]);
    expect(lockAttempts).toBe(2);
    expect(audits).toHaveLength(2);
    expect(audits[0].metadata).toEqual(expect.objectContaining({
      before: expect.objectContaining({ status: ReportStatus.open }),
      after: expect.objectContaining({ status: ReportStatus.reviewing }),
    }));
    expect(audits[1].metadata.before).toEqual(audits[0].metadata.after);
    expect(audits[1].metadata.after).toEqual(expect.objectContaining({
      status: ReportStatus.resolved,
      resolutionNote: 'Policy violation confirmed',
    }));
  });

  it('bans a user, revokes every active session, and writes audit/outbox in the same transaction', async () => {
    const before = {
      id: '123e4567-e89b-42d3-a456-426614174888',
      email: 'user@example.com',
      username: 'user',
      displayName: null,
      moderationStatus: 'active',
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
    };
    const { tx, service } = mutationHarness({
      user: {
        findUnique: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue({
          ...before,
          moderationStatus: 'banned',
          bannedAt: new Date(),
          banReason: 'Severe abuse',
        }),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      loginSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    });

    await expect(service.banUser(actor, mutation(1), before.id, { reason: 'Severe abuse' }))
      .resolves.toEqual(expect.objectContaining({
        revokedRefreshTokens: 3,
        revokedLoginSessions: 2,
      }));

    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: before.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.loginSession.updateMany).toHaveBeenCalledWith({
      where: { userId: before.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'admin.user.banned', requestId: mutation(1).requestId }),
    });
    expect(tx.adminOutboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'admin.user.banned', requestId: mutation(1).requestId }),
    });
  });

  it('revokes user sessions without changing moderation state and records the containment action', async () => {
    const userId = '123e4567-e89b-42d3-a456-426614174889';
    const { tx, service } = mutationHarness({
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId }),
        update: jest.fn(),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 4 }) },
      loginSession: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    });

    await expect(service.revokeUserSessions(actor, mutation(23), userId, {
      note: 'Credential compromise reported',
    })).resolves.toEqual({
      userId,
      revokedRefreshTokens: 4,
      revokedLoginSessions: 3,
    });

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.loginSession.updateMany).toHaveBeenCalledWith({
      where: { userId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'admin.user.sessions_revoked',
        requestId: mutation(23).requestId,
        metadata: expect.objectContaining({
          note: 'Credential compromise reported',
          revokedRefreshTokens: 4,
          revokedLoginSessions: 3,
        }),
      }),
    });
    expect(tx.adminOutboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'admin.user.sessions_revoked',
        requestId: mutation(23).requestId,
        payload: expect.objectContaining({
          userId,
          revokedRefreshTokens: 4,
          revokedLoginSessions: 3,
        }),
      }),
    });
  });

  it('does not create a session-revocation audit event for an unknown user', async () => {
    const { tx, service } = mutationHarness({
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      refreshToken: { updateMany: jest.fn() },
      loginSession: { updateMany: jest.fn() },
    });

    await expect(service.revokeUserSessions(
      actor,
      mutation(24),
      '123e4567-e89b-42d3-a456-426614174890',
      {},
    )).rejects.toThrow('User was not found');

    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(tx.loginSession.updateMany).not.toHaveBeenCalled();
    expect(tx.adminAuditEvent.create).not.toHaveBeenCalled();
    expect(tx.adminOutboxEvent.create).not.toHaveBeenCalled();
  });

  it('quarantines and restores a message with durable state, audit, outbox, and idempotency in one transaction', async () => {
    let stored = {
      id: '123e4567-e89b-42d3-a456-426614174999',
      moderationStatus: 'active',
      quarantinedAt: null as Date | null,
      quarantinedById: null as string | null,
      quarantineReason: null as string | null,
    };
    const message = {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...stored })),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        body: 'preserved evidence',
        sender: { displayName: 'Reported User', username: 'reported-user' },
      }),
      update: jest.fn().mockImplementation(({ data }: any) => {
        stored = { ...stored, ...data };
        return Promise.resolve({ ...stored });
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const { tx, service } = mutationHarness({ message });

    await expect(service.quarantineMessage(actor, mutation(15), stored.id, { reason: ' Credible abuse ' }))
      .resolves.toEqual({
        message: expect.objectContaining({
          id: stored.id,
          moderationStatus: 'quarantined',
          quarantinedAt: expect.any(String),
          quarantinedById: actor.id,
          quarantineReason: 'Credible abuse',
        }),
      });
    expect(message.update).toHaveBeenLastCalledWith({
      where: { id: stored.id },
      data: {
        moderationStatus: 'quarantined',
        quarantinedAt: expect.any(Date),
        quarantinedById: actor.id,
        quarantineReason: 'Credible abuse',
      },
      select: expect.any(Object),
    });
    expect(message.updateMany).toHaveBeenLastCalledWith({
      where: { referenceType: 'message', referenceId: stored.id },
      data: {
        referenceText: null,
        referenceAuthorName: null,
        referenceMediaUrl: null,
      },
    });
    expect(tx.adminAuditEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: 'admin.message.quarantined',
        targetType: 'message',
        targetId: stored.id,
        requestId: mutation(15).requestId,
      }),
    });
    expect(tx.adminOutboxEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        eventType: 'admin.message.quarantined',
        aggregateType: 'message',
        aggregateId: stored.id,
        requestId: mutation(15).requestId,
      }),
    });

    await expect(service.restoreMessage(actor, mutation(16), stored.id, { note: ' Appeal upheld ' }))
      .resolves.toEqual({
        message: {
          id: stored.id,
          moderationStatus: 'active',
          quarantinedAt: null,
          quarantinedById: null,
          quarantineReason: null,
        },
      });
    expect(message.update).toHaveBeenLastCalledWith({
      where: { id: stored.id },
      data: {
        moderationStatus: 'active',
        quarantinedAt: null,
        quarantinedById: null,
        quarantineReason: null,
      },
      select: expect.any(Object),
    });
    expect(message.updateMany).toHaveBeenLastCalledWith({
      where: { referenceType: 'message', referenceId: stored.id },
      data: {
        referenceText: 'preserved evidence',
        referenceAuthorName: 'Reported User',
        referenceMediaUrl: null,
      },
    });
    expect(tx.adminAuditEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ action: 'admin.message.restored', requestId: mutation(16).requestId }),
    });
    expect(tx.adminOutboxEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ eventType: 'admin.message.restored', requestId: mutation(16).requestId }),
    });
    expect(tx.adminIdempotencyRecord.create).toHaveBeenCalledTimes(2);
  });

  it('persists assignment, escalation, immutable notes, appeal state, and evidence retention as audited mutations', async () => {
    const report = postReport();
    const appeal = {
      id: '123e4567-e89b-42d3-a456-426614174901',
      reportType: ModerationReportType.post,
      reportId: report.id,
      appellantUserId: null,
      statement: 'Please review',
      status: ReportAppealStatus.submitted,
      assignedReviewerId: null,
      assignedAt: null,
      reviewedAt: null,
      reviewedById: null,
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const evidence = {
      id: '123e4567-e89b-42d3-a456-426614174902',
      reportType: ModerationReportType.post,
      reportId: report.id,
      storageKey: 'moderation/evidence/file.png',
      sha256: 'a'.repeat(64),
      mediaType: 'image/png',
      byteSize: 100,
      metadata: { source: 'support' },
      retentionExpiresAt: new Date(Date.now() + 86_400_000),
      legalHold: false,
      createdById: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const postReportDelegate = {
      findUnique: jest.fn().mockResolvedValue(report),
      update: jest.fn().mockImplementation(({ data }: any) => ({
        ...report,
        ...data,
        updatedAt: new Date(),
      })),
    };
    const { tx, service } = mutationHarness({
      postReport: postReportDelegate,
      adminReportInternalNote: {
        create: jest.fn().mockResolvedValue({
          id: '123e4567-e89b-42d3-a456-426614174903',
          reportType: ModerationReportType.post,
          reportId: report.id,
          authorId: actor.id,
          body: 'Internal-only note',
          createdAt: new Date(),
        }),
      },
      adminReportAppeal: {
        create: jest.fn().mockResolvedValue(appeal),
        findUnique: jest.fn().mockResolvedValue(appeal),
        update: jest.fn().mockResolvedValue({
          ...appeal,
          status: ReportAppealStatus.overturned,
          assignedReviewerId: actor.id,
          reviewedAt: new Date(),
          reviewedById: actor.id,
          resolutionNote: 'Decision corrected',
        }),
      },
      adminReportEvidence: {
        create: jest.fn().mockResolvedValue(evidence),
        findUnique: jest.fn().mockResolvedValue(evidence),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...evidence,
          legalHold: true,
        }),
      },
    });

    await service.assignReport(actor, mutation(2), ModerationReportType.post, report.id, {
      reviewerId: 'admin:reviewer-2',
      slaDueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await service.escalateReport(actor, mutation(3), ModerationReportType.post, report.id, {
      level: 3,
      reason: 'Credible imminent harm',
      priority: 100,
    });
    await service.addInternalNote(actor, mutation(4), ModerationReportType.post, report.id, {
      body: 'Internal-only note',
    });
    await service.createAppeal(actor, mutation(5), ModerationReportType.post, report.id, {
      statement: 'Please review',
    });
    await service.reviewAppeal(actor, mutation(6), appeal.id, {
      status: ReportAppealStatus.overturned,
      resolutionNote: 'Decision corrected',
    });
    await service.createEvidence(actor, mutation(7), ModerationReportType.post, report.id, {
      storageKey: evidence.storageKey,
      sha256: evidence.sha256,
      mediaType: evidence.mediaType,
      byteSize: evidence.byteSize,
      metadata: evidence.metadata,
      retentionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await service.updateEvidenceRetention(actor, mutation(8), evidence.id, { legalHold: true });

    expect(postReportDelegate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedReviewerId: 'admin:reviewer-2', assignedAt: expect.any(Date) }),
    }));
    expect(postReportDelegate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ escalationLevel: 3, priority: 100, escalatedById: actor.id }),
    }));
    expect(tx.adminReportInternalNote.create).toHaveBeenCalled();
    expect(tx.adminReportAppeal.create).toHaveBeenCalled();
    expect(tx.adminReportAppeal.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ReportAppealStatus.overturned, reviewedById: actor.id }),
    }));
    expect(tx.adminReportEvidence.create).toHaveBeenCalled();
    expect(tx.adminReportEvidence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { legalHold: true },
    }));
    expect(tx.adminAuditEvent.create).toHaveBeenCalledTimes(7);
    expect(tx.adminOutboxEvent.create).toHaveBeenCalledTimes(7);
  });

  it('cannot shorten evidence retention if a concurrent legal hold is active', async () => {
    const retentionExpiresAt = new Date(Date.now() + 2 * 86_400_000);
    const evidence = {
      id: '123e4567-e89b-42d3-a456-426614174910',
      reportType: ModerationReportType.post,
      reportId: '123e4567-e89b-42d3-a456-426614174111',
      storageKey: 'moderation/evidence/file.png',
      sha256: 'a'.repeat(64),
      mediaType: 'image/png',
      byteSize: 100,
      metadata: {},
      retentionExpiresAt,
      legalHold: false,
      createdById: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { tx, service } = mutationHarness({
      adminReportEvidence: {
        findUnique: jest.fn().mockResolvedValue(evidence),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
      },
    });
    const shorterExpiry = new Date(Date.now() + 86_400_000);

    await expect(service.updateEvidenceRetention(actor, mutation(12), evidence.id, {
      retentionExpiresAt: shorterExpiry.toISOString(),
      legalHold: false,
    })).rejects.toThrow('separate mutation');

    expect(tx.adminReportEvidence.updateMany).toHaveBeenCalledWith({
      where: {
        id: evidence.id,
        OR: [
          { legalHold: false },
          { retentionExpiresAt: { lte: shorterExpiry } },
        ],
      },
      data: {
        retentionExpiresAt: shorterExpiry,
        legalHold: false,
      },
    });
    expect(tx.adminReportEvidence.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('replays the stored response without opening another mutation transaction', async () => {
    const response = { post: { id: 'post-1', moderationStatus: 'quarantined' } };
    const { prisma, service } = mutationHarness();
    const operation = 'admin.post.quarantined:post:post-1';
    const input = { status: 'quarantined', reason: 'policy' };
    const requestHash = createHash('sha256')
      .update((service as any).canonicalJson({ operation, input }))
      .digest('hex');
    prisma.adminIdempotencyRecord.findUnique.mockResolvedValue({
      operation,
      requestHash,
      requestId: mutation(9).requestId,
      response,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.quarantinePost(actor, mutation(9), 'post-1', { reason: 'policy' }))
      .resolves.toEqual(response);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an existing replay when the request ID changes', async () => {
    const response = { post: { id: 'post-1', moderationStatus: 'quarantined' } };
    const { prisma, service } = mutationHarness();
    const operation = 'admin.post.quarantined:post:post-1';
    const input = { status: 'quarantined', reason: 'policy' };
    const requestHash = createHash('sha256')
      .update((service as any).canonicalJson({ operation, input }))
      .digest('hex');
    const original = mutation(9);
    prisma.adminIdempotencyRecord.findUnique.mockResolvedValue({
      operation,
      requestHash,
      requestId: original.requestId,
      response,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.quarantinePost(actor, {
      ...original,
      requestId: mutation(10).requestId,
    }, 'post-1', { reason: 'policy' }))
      .rejects.toThrow('original X-Request-ID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replays a concurrently committed winner only with the original request ID', async () => {
    const response = { post: { id: 'post-1', moderationStatus: 'quarantined' } };
    const { prisma, service } = mutationHarness();
    const operation = 'admin.post.quarantined:post:post-1';
    const input = { status: 'quarantined', reason: 'policy' };
    const requestHash = createHash('sha256')
      .update((service as any).canonicalJson({ operation, input }))
      .digest('hex');
    const request = mutation(13);
    const winner = {
      operation,
      requestHash,
      requestId: request.requestId,
      response,
      expiresAt: new Date(Date.now() + 60_000),
    };
    prisma.adminIdempotencyRecord.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    prisma.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: {
        modelName: 'AdminIdempotencyRecord',
        target: ['request_id'],
      },
    });

    await expect(service.quarantinePost(actor, request, 'post-1', { reason: 'policy' }))
      .resolves.toEqual(response);
  });

  it('rejects a concurrently committed winner when the request ID changes', async () => {
    const { prisma, service } = mutationHarness();
    const operation = 'admin.post.quarantined:post:post-1';
    const input = { status: 'quarantined', reason: 'policy' };
    const requestHash = createHash('sha256')
      .update((service as any).canonicalJson({ operation, input }))
      .digest('hex');
    const request = mutation(14);
    prisma.adminIdempotencyRecord.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        operation,
        requestHash,
        requestId: mutation(13).requestId,
        response: { post: { id: 'post-1', moderationStatus: 'quarantined' } },
        expiresAt: new Date(Date.now() + 60_000),
      });
    prisma.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: {
        modelName: 'AdminIdempotencyRecord',
        target: ['actor_id', 'key'],
      },
    });

    await expect(service.quarantinePost(actor, request, 'post-1', { reason: 'policy' }))
      .rejects.toThrow('original X-Request-ID');
  });

  it('returns 409 when a permanent audit request ID outlives its expired idempotency record', async () => {
    const { prisma, service } = mutationHarness();
    prisma.adminIdempotencyRecord.findMany.mockResolvedValue([{ id: 'expired-idempotency-record' }]);
    prisma.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: {
        modelName: 'AdminAuditEvent',
        target: ['request_id'],
      },
    });

    await expect(service.quarantinePost(actor, mutation(22), 'post-1', { reason: 'policy' }))
      .rejects.toEqual(expect.objectContaining({
        status: 409,
        message: 'X-Request-ID has already been used',
      }));
    expect(prisma.adminIdempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['expired-idempotency-record'] } },
    });
    expect(prisma.adminIdempotencyRecord.findUnique).toHaveBeenCalledTimes(2);
  });

  it('only classifies known admin idempotency, audit, and outbox constraints as replay collisions', () => {
    const service = new AdminModerationService({} as any);
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { modelName: 'AdminIdempotencyRecord', target: ['actor_id', 'key'] },
    })).toBe('actor-key');
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { modelName: 'AdminIdempotencyRecord', target: ['request_id'] },
    })).toBe('request-id');
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { modelName: 'AdminAuditEvent', target: ['requestId'] },
    })).toBe('request-id');
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { modelName: 'AdminOutboxEvent', target: ['request_id'] },
    })).toBe('request-id');
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { target: ['admin_outbox_events_request_id_key'] },
    })).toBe('request-id');
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { target: ['slug'] },
    })).toBeNull();
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { modelName: 'SomeDomainRecord', target: ['request_id'] },
    })).toBeNull();
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { target: ['request_id'] },
    })).toBeNull();
    expect((service as any).idempotencyCollision({
      code: 'P2002',
      meta: { modelName: 'AdminIdempotencyRecord', target: ['not_actor_id', 'key'] },
    })).toBeNull();
  });

  it('rejects an idempotency key reused for another operation', async () => {
    const { prisma, service } = mutationHarness();
    prisma.adminIdempotencyRecord.findUnique.mockResolvedValue({
      operation: 'different-operation',
      requestHash: 'different-hash',
      requestId: mutation(10).requestId,
      response: { ok: true },
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.quarantinePost(actor, mutation(10), 'post-1', { reason: 'policy' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('cleans at most 100 expired idempotency rows per mutation attempt', async () => {
    const { prisma, service } = mutationHarness();
    prisma.adminIdempotencyRecord.findMany.mockResolvedValue([{ id: 'expired-1' }]);
    prisma.adminIdempotencyRecord.findUnique.mockResolvedValue({
      operation: 'different-operation',
      requestHash: 'different-hash',
      requestId: mutation(11).requestId,
      response: { ok: true },
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.quarantinePost(actor, mutation(11), 'post-1', { reason: 'policy' })).rejects.toThrow();
    expect(prisma.adminIdempotencyRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(prisma.adminIdempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['expired-1'] } },
    });
  });
});
