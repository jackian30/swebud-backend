import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContentModerationStatus,
  ModerationReportType,
  Prisma,
  ReportAppealStatus,
  ReportCategory,
  ReportStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddAdminReportNoteDto,
  AdminReportQueryDto,
  AssignAdminReportDto,
  BanAdminUserDto,
  CreateAdminAppealDto,
  CreateAdminEvidenceDto,
  EscalateAdminReportDto,
  QuarantineAdminContentDto,
  RevokeAdminUserSessionsDto,
  RestoreAdminContentDto,
  ReviewAdminAppealDto,
  UnbanAdminUserDto,
  UpdateAdminEvidenceRetentionDto,
  UpdateAdminReportDto,
} from './dto';
import { AdminMutationContext, AdminPrincipal } from './admin-moderation.types';

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const TERMINAL_REPORT_STATUSES = new Set<ReportStatus>([ReportStatus.resolved, ReportStatus.dismissed]);
const TERMINAL_APPEAL_STATUSES = new Set<ReportAppealStatus>([
  ReportAppealStatus.upheld,
  ReportAppealStatus.overturned,
  ReportAppealStatus.dismissed,
]);

type MutationResult<T> = {
  response: T;
  metadata: Record<string, unknown>;
  outbox: Record<string, unknown>;
};

type MutationSpec = {
  action: string;
  targetType: string;
  targetId: string;
  input: unknown;
};

@Injectable()
export class AdminModerationService {
  constructor(private readonly prisma: PrismaService) {}

  async reports(query: AdminReportQueryDto) {
    const take = query.take ?? 50;
    const cursor = query.cursor ?? 0;
    const fetchTake = cursor + take + 1;
    const types = query.type ? [query.type] : Object.values(ModerationReportType);
    const now = new Date();
    const [groups, summary] = await Promise.all([
      Promise.all(types.map(async (type) => {
        const rows = await this.reportDelegate(this.prisma, type).findMany({
          where: this.reportWhere(query, {}, now),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: fetchTake,
          include: this.reportInclude(type),
        });
        return rows.map((row: unknown) => this.normalizeReport(type, row));
      })),
      this.reportSummary(query, types, now),
    ]);
    const merged = groups.flat().sort((left, right) => (
      right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id)
    ));
    const items = merged.slice(cursor, cursor + take);
    const lifecycle = await this.lifecycleSummaries(items.map((item) => ({ type: item.type, id: item.id })));
    return {
      items: items.map((item) => ({
        ...item,
        internalNoteCount: lifecycle.notes.get(this.reportKey(item.type, item.id)) ?? 0,
        appeals: lifecycle.appeals.get(this.reportKey(item.type, item.id)) ?? [],
        evidenceRetention: lifecycle.evidence.get(this.reportKey(item.type, item.id)) ?? [],
      })),
      nextCursor: merged.length > cursor + take ? cursor + take : null,
      summary,
    };
  }

  async internalNotes(type: ModerationReportType, reportId: string) {
    await this.requireReport(this.prisma, type, reportId);
    return this.prisma.adminReportInternalNote.findMany({
      where: { reportType: type, reportId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async appeals(type: ModerationReportType, reportId: string) {
    await this.requireReport(this.prisma, type, reportId);
    return this.prisma.adminReportAppeal.findMany({
      where: { reportType: type, reportId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async evidence(type: ModerationReportType, reportId: string) {
    await this.requireReport(this.prisma, type, reportId);
    return this.prisma.adminReportEvidence.findMany({
      where: { reportType: type, reportId },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateReport(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    type: ModerationReportType,
    reportId: string,
    dto: UpdateAdminReportDto,
  ) {
    const resolutionNote = dto.resolutionNote?.trim();
    if (TERMINAL_REPORT_STATUSES.has(dto.status) && !resolutionNote) {
      throw new BadRequestException('A resolution note is required for terminal report statuses');
    }
    return this.execute(actor, mutation, {
      action: 'admin.report.updated',
      targetType: `${type}_report`,
      targetId: reportId,
      input: dto,
    }, async (tx) => {
      await this.lockReport(tx, type, reportId);
      const before = await this.requireReport(tx, type, reportId);
      const terminal = TERMINAL_REPORT_STATUSES.has(dto.status);
      const updated = await this.reportDelegate(tx, type).update({
        where: { id: reportId },
        data: {
          status: dto.status,
          actionTaken: dto.actionTaken?.trim() || null,
          resolutionNote: resolutionNote || null,
          reviewedAt: dto.status === ReportStatus.open ? null : new Date(),
          reviewedById: dto.status === ReportStatus.open ? null : actor.id,
          ...(terminal ? {} : { resolutionNote: resolutionNote || null }),
        },
        include: this.reportInclude(type),
      });
      const response = this.normalizeReport(type, updated);
      return {
        response,
        metadata: { before: this.reportAuditSnapshot(before), after: this.reportAuditSnapshot(response) },
        outbox: { reportType: type, reportId, status: response.status },
      };
    });
  }

  assignReport(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    type: ModerationReportType,
    reportId: string,
    dto: AssignAdminReportDto,
  ) {
    if (dto.reviewerId === undefined && dto.slaDueAt === undefined) {
      throw new BadRequestException('At least one assignment or SLA field is required');
    }
    const reviewerId = dto.reviewerId?.trim() || null;
    const slaDueAt = dto.slaDueAt === null ? null : dto.slaDueAt ? this.futureDate(dto.slaDueAt, 'SLA due timestamp') : undefined;
    return this.execute(actor, mutation, {
      action: 'admin.report.assigned',
      targetType: `${type}_report`,
      targetId: reportId,
      input: dto,
    }, async (tx) => {
      await this.lockReport(tx, type, reportId);
      const before = await this.requireReport(tx, type, reportId);
      const updated = await this.reportDelegate(tx, type).update({
        where: { id: reportId },
        data: {
          ...(dto.reviewerId !== undefined ? {
            assignedReviewerId: reviewerId,
            assignedAt: reviewerId ? new Date() : null,
          } : {}),
          ...(slaDueAt !== undefined ? { slaDueAt } : {}),
        },
        include: this.reportInclude(type),
      });
      const response = this.normalizeReport(type, updated);
      return {
        response,
        metadata: { before: this.reportAuditSnapshot(before), after: this.reportAuditSnapshot(response) },
        outbox: { reportType: type, reportId, reviewerId: response.assignedReviewerId, slaDueAt: response.slaDueAt },
      };
    });
  }

  addInternalNote(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    type: ModerationReportType,
    reportId: string,
    dto: AddAdminReportNoteDto,
  ) {
    return this.execute(actor, mutation, {
      action: 'admin.report.internal_note_added',
      targetType: `${type}_report`,
      targetId: reportId,
      input: dto,
    }, async (tx) => {
      await this.requireReport(tx, type, reportId);
      const note = await tx.adminReportInternalNote.create({
        data: { reportType: type, reportId, authorId: actor.id, body: dto.body.trim() },
      });
      return {
        response: note,
        metadata: { noteId: note.id },
        outbox: { reportType: type, reportId, noteId: note.id },
      };
    });
  }

  escalateReport(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    type: ModerationReportType,
    reportId: string,
    dto: EscalateAdminReportDto,
  ) {
    const slaDueAt = dto.slaDueAt === null ? null : dto.slaDueAt ? this.futureDate(dto.slaDueAt, 'SLA due timestamp') : undefined;
    return this.execute(actor, mutation, {
      action: 'admin.report.escalated',
      targetType: `${type}_report`,
      targetId: reportId,
      input: dto,
    }, async (tx) => {
      await this.lockReport(tx, type, reportId);
      const before = await this.requireReport(tx, type, reportId);
      const updated = await this.reportDelegate(tx, type).update({
        where: { id: reportId },
        data: {
          escalationLevel: dto.level,
          escalationReason: dto.reason.trim(),
          escalatedAt: new Date(),
          escalatedById: actor.id,
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(slaDueAt !== undefined ? { slaDueAt } : {}),
        },
        include: this.reportInclude(type),
      });
      const response = this.normalizeReport(type, updated);
      return {
        response,
        metadata: { before: this.reportAuditSnapshot(before), after: this.reportAuditSnapshot(response) },
        outbox: { reportType: type, reportId, escalationLevel: response.escalationLevel, priority: response.priority },
      };
    });
  }

  createAppeal(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    type: ModerationReportType,
    reportId: string,
    dto: CreateAdminAppealDto,
  ) {
    return this.execute(actor, mutation, {
      action: 'admin.appeal.intake_recorded',
      targetType: `${type}_report`,
      targetId: reportId,
      input: dto,
    }, async (tx) => {
      await this.requireReport(tx, type, reportId);
      if (dto.appellantUserId) {
        const appellant = await tx.user.findUnique({ where: { id: dto.appellantUserId }, select: { id: true } });
        if (!appellant) throw new NotFoundException('Appeal appellant was not found');
      }
      const appeal = await tx.adminReportAppeal.create({
        data: {
          reportType: type,
          reportId,
          appellantUserId: dto.appellantUserId,
          statement: dto.statement.trim(),
        },
      });
      return {
        response: appeal,
        metadata: { appealId: appeal.id, appellantUserId: appeal.appellantUserId },
        outbox: { reportType: type, reportId, appealId: appeal.id, status: appeal.status },
      };
    });
  }

  reviewAppeal(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    appealId: string,
    dto: ReviewAdminAppealDto,
  ) {
    const resolutionNote = dto.resolutionNote?.trim();
    if (TERMINAL_APPEAL_STATUSES.has(dto.status) && !resolutionNote) {
      throw new BadRequestException('A resolution note is required for a terminal appeal decision');
    }
    return this.execute(actor, mutation, {
      action: 'admin.appeal.reviewed',
      targetType: 'report_appeal',
      targetId: appealId,
      input: dto,
    }, async (tx) => {
      await this.lockAppeal(tx, appealId);
      const before = await tx.adminReportAppeal.findUnique({ where: { id: appealId } });
      if (!before) throw new NotFoundException('Appeal was not found');
      const reviewerId = dto.reviewerId === undefined ? (before.assignedReviewerId ?? actor.id) : (dto.reviewerId?.trim() || null);
      const terminal = TERMINAL_APPEAL_STATUSES.has(dto.status) || dto.status === ReportAppealStatus.withdrawn;
      const appeal = await tx.adminReportAppeal.update({
        where: { id: appealId },
        data: {
          status: dto.status,
          assignedReviewerId: reviewerId,
          assignedAt: reviewerId && !before.assignedAt ? new Date() : reviewerId ? before.assignedAt : null,
          reviewedAt: terminal ? new Date() : null,
          reviewedById: terminal ? actor.id : null,
          resolutionNote: resolutionNote || null,
        },
      });
      return {
        response: appeal,
        metadata: {
          before: this.appealAuditSnapshot(before),
          after: this.appealAuditSnapshot(appeal),
        },
        outbox: { appealId, reportType: appeal.reportType, reportId: appeal.reportId, status: appeal.status },
      };
    });
  }

  createEvidence(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    type: ModerationReportType,
    reportId: string,
    dto: CreateAdminEvidenceDto,
  ) {
    const retentionExpiresAt = this.futureDate(dto.retentionExpiresAt, 'Evidence retention expiry');
    this.assertStorageKey(dto.storageKey);
    return this.execute(actor, mutation, {
      action: 'admin.report.evidence_registered',
      targetType: `${type}_report`,
      targetId: reportId,
      input: dto,
    }, async (tx) => {
      await this.requireReport(tx, type, reportId);
      const evidence = await tx.adminReportEvidence.create({
        data: {
          reportType: type,
          reportId,
          storageKey: dto.storageKey.trim(),
          sha256: dto.sha256.toLowerCase(),
          mediaType: dto.mediaType.toLowerCase(),
          byteSize: dto.byteSize,
          metadata: dto.metadata as Prisma.InputJsonValue,
          retentionExpiresAt,
          legalHold: dto.legalHold ?? false,
          createdById: actor.id,
        },
      });
      return {
        response: evidence,
        metadata: {
          evidenceId: evidence.id,
          sha256: evidence.sha256,
          retentionExpiresAt: evidence.retentionExpiresAt,
          legalHold: evidence.legalHold,
        },
        outbox: { reportType: type, reportId, evidenceId: evidence.id, retentionExpiresAt: evidence.retentionExpiresAt },
      };
    });
  }

  updateEvidenceRetention(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    evidenceId: string,
    dto: UpdateAdminEvidenceRetentionDto,
  ) {
    if (dto.retentionExpiresAt === undefined && dto.legalHold === undefined && dto.metadata === undefined) {
      throw new BadRequestException('At least one evidence retention field is required');
    }
    const retentionExpiresAt = dto.retentionExpiresAt
      ? this.futureDate(dto.retentionExpiresAt, 'Evidence retention expiry')
      : undefined;
    return this.execute(actor, mutation, {
      action: 'admin.report.evidence_retention_updated',
      targetType: 'report_evidence',
      targetId: evidenceId,
      input: dto,
    }, async (tx) => {
      await this.lockEvidence(tx, evidenceId);
      const before = await tx.adminReportEvidence.findUnique({ where: { id: evidenceId } });
      if (!before) throw new NotFoundException('Evidence record was not found');
      if (
        before.legalHold
        && retentionExpiresAt
        && retentionExpiresAt.getTime() < before.retentionExpiresAt.getTime()
      ) {
        throw new BadRequestException('Clear the legal hold before shortening evidence retention');
      }
      const updated = await tx.adminReportEvidence.updateMany({
        where: {
          id: evidenceId,
          ...(retentionExpiresAt ? {
            OR: [
              { legalHold: false },
              { retentionExpiresAt: { lte: retentionExpiresAt } },
            ],
          } : {}),
        },
        data: {
          ...(retentionExpiresAt ? { retentionExpiresAt } : {}),
          ...(dto.legalHold !== undefined ? { legalHold: dto.legalHold } : {}),
          ...(dto.metadata !== undefined ? { metadata: dto.metadata as Prisma.InputJsonValue } : {}),
        },
      });
      if (updated.count !== 1) {
        throw new BadRequestException('Clear the legal hold in a separate mutation before shortening evidence retention');
      }
      const evidence = await tx.adminReportEvidence.findUniqueOrThrow({ where: { id: evidenceId } });
      return {
        response: evidence,
        metadata: {
          before: this.evidenceAuditSnapshot(before),
          after: this.evidenceAuditSnapshot(evidence),
        },
        outbox: {
          evidenceId,
          reportType: evidence.reportType,
          reportId: evidence.reportId,
          retentionExpiresAt: evidence.retentionExpiresAt,
          legalHold: evidence.legalHold,
        },
      };
    });
  }

  banUser(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    userId: string,
    dto: BanAdminUserDto,
  ) {
    const bannedUntil = dto.bannedUntil ? this.futureDate(dto.bannedUntil, 'Ban expiry') : null;
    return this.execute(actor, mutation, {
      action: 'admin.user.banned',
      targetType: 'user',
      targetId: userId,
      input: dto,
    }, async (tx) => {
      await this.lockUser(tx, userId);
      const before = await tx.user.findUnique({ where: { id: userId }, select: this.userModerationSelect() });
      if (!before) throw new NotFoundException('User was not found');
      const now = new Date();
      const [user, revokedRefreshTokens, revokedLoginSessions] = await Promise.all([
        tx.user.update({
          where: { id: userId },
          data: {
            moderationStatus: 'banned',
            bannedAt: now,
            bannedUntil,
            banReason: dto.reason.trim(),
          },
          select: this.userModerationSelect(),
        }),
        tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
        tx.loginSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
      ]);
      const response = {
        user,
        revokedRefreshTokens: revokedRefreshTokens.count,
        revokedLoginSessions: revokedLoginSessions.count,
      };
      return {
        response,
        metadata: { before, after: user, revokedRefreshTokens: response.revokedRefreshTokens, revokedLoginSessions: response.revokedLoginSessions },
        outbox: { userId, moderationStatus: user.moderationStatus, bannedUntil: user.bannedUntil },
      };
    });
  }

  unbanUser(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    userId: string,
    dto: UnbanAdminUserDto,
  ) {
    return this.execute(actor, mutation, {
      action: 'admin.user.unbanned',
      targetType: 'user',
      targetId: userId,
      input: dto,
    }, async (tx) => {
      await this.lockUser(tx, userId);
      const before = await tx.user.findUnique({ where: { id: userId }, select: this.userModerationSelect() });
      if (!before) throw new NotFoundException('User was not found');
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          moderationStatus: 'active',
          bannedAt: null,
          bannedUntil: null,
          banReason: null,
        },
        select: this.userModerationSelect(),
      });
      return {
        response: { user },
        metadata: { before, after: user, note: dto.note?.trim() || null },
        outbox: { userId, moderationStatus: user.moderationStatus },
      };
    });
  }

  revokeUserSessions(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    userId: string,
    dto: RevokeAdminUserSessionsDto,
  ) {
    return this.execute(actor, mutation, {
      action: 'admin.user.sessions_revoked',
      targetType: 'user',
      targetId: userId,
      input: dto,
    }, async (tx) => {
      await this.lockUser(tx, userId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('User was not found');

      const revokedAt = new Date();
      const [revokedRefreshTokens, revokedLoginSessions] = await Promise.all([
        tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt },
        }),
        tx.loginSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt },
        }),
      ]);
      const response = {
        userId,
        revokedRefreshTokens: revokedRefreshTokens.count,
        revokedLoginSessions: revokedLoginSessions.count,
      };
      return {
        response,
        metadata: {
          ...response,
          note: dto.note?.trim() || null,
        },
        outbox: response,
      };
    });
  }

  quarantinePost(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    postId: string,
    dto: QuarantineAdminContentDto,
  ) {
    return this.contentMutation(actor, mutation, 'post', postId, ContentModerationStatus.quarantined, dto.reason);
  }

  restorePost(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    postId: string,
    dto: RestoreAdminContentDto,
  ) {
    return this.contentMutation(actor, mutation, 'post', postId, ContentModerationStatus.active, dto.note);
  }

  quarantineGroup(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    groupId: string,
    dto: QuarantineAdminContentDto,
  ) {
    return this.contentMutation(actor, mutation, 'group', groupId, ContentModerationStatus.quarantined, dto.reason);
  }

  restoreGroup(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    groupId: string,
    dto: RestoreAdminContentDto,
  ) {
    return this.contentMutation(actor, mutation, 'group', groupId, ContentModerationStatus.active, dto.note);
  }

  quarantineMessage(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    messageId: string,
    dto: QuarantineAdminContentDto,
  ) {
    return this.contentMutation(actor, mutation, 'message', messageId, ContentModerationStatus.quarantined, dto.reason);
  }

  restoreMessage(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    messageId: string,
    dto: RestoreAdminContentDto,
  ) {
    return this.contentMutation(actor, mutation, 'message', messageId, ContentModerationStatus.active, dto.note);
  }

  private contentMutation(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    targetType: 'post' | 'group' | 'message',
    targetId: string,
    status: ContentModerationStatus,
    reason?: string,
  ) {
    const action = status === ContentModerationStatus.quarantined
      ? `admin.${targetType}.quarantined`
      : `admin.${targetType}.restored`;
    return this.execute(actor, mutation, {
      action,
      targetType,
      targetId,
      input: { status, reason: reason?.trim() || null },
    }, async (tx) => {
      const delegate = targetType === 'post'
        ? tx.post
        : targetType === 'group'
          ? tx.group
          : tx.message;
      await this.lockContent(tx, targetType, targetId);
      const before = await (delegate as any).findUnique({
        where: { id: targetId },
        select: this.contentModerationSelect(),
      });
      if (!before) {
        const label = targetType === 'post' ? 'Post' : targetType === 'group' ? 'Group' : 'Message';
        throw new NotFoundException(`${label} was not found`);
      }
      const messageReference = targetType === 'message'
        ? await tx.message.findUniqueOrThrow({
            where: { id: targetId },
            select: {
              body: true,
              sender: { select: { displayName: true, username: true } },
            },
          })
        : null;
      const now = new Date();
      const content = await (delegate as any).update({
        where: { id: targetId },
        data: status === ContentModerationStatus.quarantined
          ? {
              moderationStatus: status,
              quarantinedAt: now,
              quarantinedById: actor.id,
              quarantineReason: reason?.trim() || null,
            }
          : {
              moderationStatus: status,
              quarantinedAt: null,
              quarantinedById: null,
              quarantineReason: null,
            },
        select: this.contentModerationSelect(),
      });
      const referencePreviews = targetType === 'message'
        ? await tx.message.updateMany({
            where: { referenceType: 'message', referenceId: targetId },
            data: status === ContentModerationStatus.quarantined
              ? {
                  referenceText: null,
                  referenceAuthorName: null,
                  referenceMediaUrl: null,
                }
              : {
                  referenceText: messageReference!.body.slice(0, 500),
                  referenceAuthorName: (
                    messageReference!.sender.displayName
                    || messageReference!.sender.username
                    || ''
                  ).slice(0, 120) || null,
                  referenceMediaUrl: null,
                },
          })
        : { count: 0 };
      return {
        response: { [targetType]: content },
        metadata: {
          before,
          after: content,
          referencePreviewsUpdated: referencePreviews.count,
          note: status === ContentModerationStatus.active ? reason?.trim() || null : undefined,
        },
        outbox: {
          [`${targetType}Id`]: targetId,
          moderationStatus: status,
          referencePreviewsUpdated: referencePreviews.count,
        },
      };
    });
  }

  private async execute<T>(
    actor: AdminPrincipal,
    mutation: AdminMutationContext,
    spec: MutationSpec,
    work: (tx: Prisma.TransactionClient) => Promise<MutationResult<T>>,
  ): Promise<T> {
    const operation = `${spec.action}:${spec.targetType}:${spec.targetId}`;
    const requestHash = createHash('sha256')
      .update(this.canonicalJson({ operation, input: spec.input }))
      .digest('hex');
    await this.cleanupExpiredIdempotencyRecords();
    const existing = await this.prisma.adminIdempotencyRecord.findUnique({
      where: { actorId_key: { actorId: actor.id, key: mutation.idempotencyKey } },
    });
    if (existing) return this.replay(existing, operation, requestHash, mutation.requestId) as T;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const claim = await tx.adminIdempotencyRecord.create({
          data: {
            actorId: actor.id,
            key: mutation.idempotencyKey,
            operation,
            requestHash,
            requestId: mutation.requestId,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
          },
        });
        const result = await work(tx);
        const response = this.jsonValue(result.response);
        await tx.adminAuditEvent.create({
          data: {
            requestId: mutation.requestId,
            actorId: actor.id,
            actorJti: actor.jti,
            action: spec.action,
            targetType: spec.targetType,
            targetId: spec.targetId,
            metadata: this.jsonValue({
              ...result.metadata,
              idempotencyRecordId: claim.id,
              requestHash,
            }) as Prisma.InputJsonValue,
          },
        });
        await tx.adminOutboxEvent.create({
          data: {
            requestId: mutation.requestId,
            eventType: spec.action,
            aggregateType: spec.targetType,
            aggregateId: spec.targetId,
            payload: this.jsonValue({
              ...result.outbox,
              requestId: mutation.requestId,
              actorId: actor.id,
            }) as Prisma.InputJsonValue,
          },
        });
        await tx.adminIdempotencyRecord.update({
          where: { id: claim.id },
          data: { response: response as Prisma.InputJsonValue },
        });
        return response as T;
      });
    } catch (error) {
      const collision = this.idempotencyCollision(error);
      if (!collision) throw error;
      const winner = await this.prisma.adminIdempotencyRecord.findUnique({
        where: { actorId_key: { actorId: actor.id, key: mutation.idempotencyKey } },
      });
      if (winner) return this.replay(winner, operation, requestHash, mutation.requestId) as T;
      if (collision === 'request-id') throw new ConflictException('X-Request-ID has already been used');
      throw new ConflictException('X-Request-ID has already been used');
    }
  }

  private replay(
    existing: {
      operation: string;
      requestHash: string;
      requestId: string;
      response: Prisma.JsonValue | null;
      expiresAt: Date;
    },
    operation: string,
    requestHash: string,
    requestId: string,
  ) {
    if (existing.operation !== operation || existing.requestHash !== requestHash) {
      throw new ConflictException('Idempotency-Key was already used for a different mutation');
    }
    if (existing.requestId !== requestId) {
      throw new ConflictException('Idempotency-Key must be retried with its original X-Request-ID');
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Idempotency-Key retention has expired; use a new key');
    }
    if (existing.response === null) throw new ConflictException('Idempotent mutation is still in progress');
    return this.jsonValue(existing.response);
  }

  private async requireReport(client: Prisma.TransactionClient, type: ModerationReportType, reportId: string) {
    const report = await this.reportDelegate(client, type).findUnique({
      where: { id: reportId },
      include: this.reportInclude(type),
    });
    if (!report) throw new NotFoundException('Report was not found');
    return this.normalizeReport(type, report);
  }

  private reportDelegate(client: PrismaService | Prisma.TransactionClient, type: ModerationReportType): any {
    if (type === ModerationReportType.post) return client.postReport;
    if (type === ModerationReportType.user) return client.userReport;
    if (type === ModerationReportType.group) return client.groupReport;
    return client.messageReport;
  }

  private lockReport(
    tx: Prisma.TransactionClient,
    type: ModerationReportType,
    reportId: string,
  ) {
    if (type === ModerationReportType.post) {
      return tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "post_reports" WHERE "id" = ${reportId} FOR UPDATE
      `);
    }
    if (type === ModerationReportType.user) {
      return tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "user_reports" WHERE "id" = ${reportId} FOR UPDATE
      `);
    }
    if (type === ModerationReportType.group) {
      return tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "group_reports" WHERE "id" = ${reportId} FOR UPDATE
      `);
    }
    return tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "message_reports" WHERE "id" = ${reportId} FOR UPDATE
    `);
  }

  private lockAppeal(tx: Prisma.TransactionClient, appealId: string) {
    return tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "admin_report_appeals" WHERE "id" = ${appealId} FOR UPDATE
    `);
  }

  private lockEvidence(tx: Prisma.TransactionClient, evidenceId: string) {
    return tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "admin_report_evidence" WHERE "id" = ${evidenceId} FOR UPDATE
    `);
  }

  private lockUser(tx: Prisma.TransactionClient, userId: string) {
    return tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE
    `);
  }

  private lockContent(
    tx: Prisma.TransactionClient,
    targetType: 'post' | 'group' | 'message',
    targetId: string,
  ) {
    if (targetType === 'post') {
      return tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "posts" WHERE "id" = ${targetId} FOR UPDATE
      `);
    }
    if (targetType === 'group') {
      return tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "groups" WHERE "id" = ${targetId} FOR UPDATE
      `);
    }
    return tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "messages" WHERE "id" = ${targetId} FOR UPDATE
    `);
  }

  private reportInclude(type: ModerationReportType) {
    const publicUser = { id: true, displayName: true, username: true, profileImageUrl: true } as const;
    if (type === ModerationReportType.post) {
      return {
        user: { select: publicUser },
        post: { select: { id: true, authorId: true, text: true, moderationStatus: true, createdAt: true } },
      };
    }
    if (type === ModerationReportType.user) {
      return {
        reporter: { select: publicUser },
        reported: {
          select: {
            ...publicUser,
            moderationStatus: true,
            bannedAt: true,
            bannedUntil: true,
            banReason: true,
            createdAt: true,
          },
        },
      };
    }
    if (type === ModerationReportType.group) {
      return {
        user: { select: publicUser },
        group: { select: { id: true, name: true, slug: true, moderationStatus: true, createdAt: true } },
      };
    }
    return {
      user: { select: publicUser },
      message: {
        select: {
          id: true,
          senderId: true,
          recipientId: true,
          groupId: true,
          buddyGroupChatId: true,
          channelId: true,
          body: true,
          deletedAt: true,
          moderationStatus: true,
          quarantinedAt: true,
          quarantinedById: true,
          quarantineReason: true,
          createdAt: true,
        },
      },
    };
  }

  private reportWhere(
    query: AdminReportQueryDto,
    options: { omitStatus?: boolean; omitCategory?: boolean } = {},
    now = new Date(),
  ) {
    return {
      ...(!options.omitStatus && query.status ? { status: query.status } : {}),
      ...(!options.omitCategory && query.category ? { category: query.category } : {}),
      ...(query.assignedReviewerId ? { assignedReviewerId: query.assignedReviewerId } : {}),
      ...(query.escalated === true ? { escalationLevel: { gt: 0 } } : {}),
      ...(query.escalated === false ? { escalationLevel: 0 } : {}),
      ...(query.overdue === true
        ? {
            AND: [
              { slaDueAt: { lt: now } },
              { status: { in: [ReportStatus.open, ReportStatus.reviewing] } },
            ],
          }
        : query.overdue === false
          ? {
              OR: [
                { slaDueAt: null },
                { slaDueAt: { gte: now } },
                { status: { notIn: [ReportStatus.open, ReportStatus.reviewing] } },
              ],
            }
          : {}),
    };
  }

  private async reportSummary(
    query: AdminReportQueryDto,
    types: ModerationReportType[],
    now: Date,
  ) {
    const grouped = await Promise.all(types.flatMap((type) => {
      const delegate = this.reportDelegate(this.prisma, type);
      return [
        delegate.groupBy({
          by: ['status'],
          where: this.reportWhere(query, { omitStatus: true }, now),
          _count: { _all: true },
        }),
        delegate.groupBy({
          by: ['category'],
          where: this.reportWhere(query, { omitCategory: true }, now),
          _count: { _all: true },
        }),
        delegate.count({
          where: this.reportWhere({ ...query, overdue: true }, {}, now),
        }),
      ];
    }));
    const statusCounts: Record<ReportStatus, number> = {
      [ReportStatus.open]: 0,
      [ReportStatus.reviewing]: 0,
      [ReportStatus.resolved]: 0,
      [ReportStatus.dismissed]: 0,
    };
    const byCategory = Object.fromEntries(
      Object.values(ReportCategory).map((category) => [category, 0]),
    ) as Record<ReportCategory, number>;

    let overdue = 0;
    for (let index = 0; index < grouped.length; index += 3) {
      for (const row of grouped[index] as { status: ReportStatus; _count: { _all: number } }[]) {
        statusCounts[row.status] += row._count._all;
      }
      for (const row of grouped[index + 1] as { category: ReportCategory; _count: { _all: number } }[]) {
        byCategory[row.category] += row._count._all;
      }
      overdue += grouped[index + 2] as number;
    }

    return {
      ...statusCounts,
      total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
      overdue,
      byCategory,
    };
  }

  private normalizeReport(type: ModerationReportType, value: unknown) {
    const row = value as Record<string, any>;
    const reporter = type === ModerationReportType.user ? row.reporter : row.user;
    const target = type === ModerationReportType.post
      ? { type: 'post', ...row.post, text: this.excerpt(row.post?.text) }
      : type === ModerationReportType.user
        ? { type: 'user', ...row.reported }
        : type === ModerationReportType.group
          ? { type: 'group', ...row.group }
          : { type: 'message', ...row.message, body: this.excerpt(row.message?.body) };
    return {
      id: row.id as string,
      type,
      target,
      reporter,
      reason: row.reason ?? null,
      category: row.category,
      note: row.note ?? null,
      details: row.details ?? null,
      status: row.status,
      priority: row.priority,
      assignedReviewerId: row.assignedReviewerId ?? null,
      assignedAt: row.assignedAt ?? null,
      slaDueAt: row.slaDueAt ?? null,
      escalationLevel: row.escalationLevel,
      escalatedAt: row.escalatedAt ?? null,
      escalatedById: row.escalatedById ?? null,
      escalationReason: row.escalationReason ?? null,
      reviewedAt: row.reviewedAt ?? null,
      reviewedById: row.reviewedById ?? null,
      actionTaken: row.actionTaken ?? null,
      resolutionNote: row.resolutionNote ?? null,
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
    };
  }

  private async lifecycleSummaries(reports: { type: ModerationReportType; id: string }[]) {
    const notes = new Map<string, number>();
    const appeals = new Map<string, unknown[]>();
    const evidence = new Map<string, unknown[]>();
    if (!reports.length) return { notes, appeals, evidence };
    const where = { OR: reports.map((report) => ({ reportType: report.type, reportId: report.id })) };
    const [noteRows, appealRows, evidenceRows] = await Promise.all([
      this.prisma.adminReportInternalNote.groupBy({
        by: ['reportType', 'reportId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.adminReportAppeal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reportType: true,
          reportId: true,
          status: true,
          assignedReviewerId: true,
          assignedAt: true,
          reviewedAt: true,
          reviewedById: true,
          resolutionNote: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.adminReportEvidence.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reportType: true,
          reportId: true,
          mediaType: true,
          byteSize: true,
          retentionExpiresAt: true,
          legalHold: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    for (const row of noteRows) notes.set(this.reportKey(row.reportType, row.reportId), row._count._all);
    for (const row of appealRows) this.pushMap(appeals, this.reportKey(row.reportType, row.reportId), row);
    for (const row of evidenceRows) this.pushMap(evidence, this.reportKey(row.reportType, row.reportId), row);
    return { notes, appeals, evidence };
  }

  private reportKey(type: ModerationReportType, id: string) {
    return `${type}:${id}`;
  }

  private pushMap(map: Map<string, unknown[]>, key: string, value: unknown) {
    const values = map.get(key) ?? [];
    values.push(value);
    map.set(key, values);
  }

  private reportAuditSnapshot(report: ReturnType<AdminModerationService['normalizeReport']>) {
    return {
      id: report.id,
      type: report.type,
      status: report.status,
      priority: report.priority,
      assignedReviewerId: report.assignedReviewerId,
      assignedAt: report.assignedAt,
      slaDueAt: report.slaDueAt,
      escalationLevel: report.escalationLevel,
      escalatedAt: report.escalatedAt,
      escalatedById: report.escalatedById,
      escalationReason: report.escalationReason,
      reviewedAt: report.reviewedAt,
      reviewedById: report.reviewedById,
      actionTaken: report.actionTaken,
      resolutionNote: report.resolutionNote,
    };
  }

  private appealAuditSnapshot(appeal: {
    id: string;
    status: ReportAppealStatus;
    assignedReviewerId: string | null;
    assignedAt: Date | null;
    reviewedAt: Date | null;
    reviewedById: string | null;
    resolutionNote: string | null;
  }) {
    return {
      id: appeal.id,
      status: appeal.status,
      assignedReviewerId: appeal.assignedReviewerId,
      assignedAt: appeal.assignedAt,
      reviewedAt: appeal.reviewedAt,
      reviewedById: appeal.reviewedById,
      resolutionNote: appeal.resolutionNote,
    };
  }

  private evidenceAuditSnapshot(evidence: {
    id: string;
    retentionExpiresAt: Date;
    legalHold: boolean;
    metadata: Prisma.JsonValue;
  }) {
    return {
      id: evidence.id,
      retentionExpiresAt: evidence.retentionExpiresAt,
      legalHold: evidence.legalHold,
      metadata: evidence.metadata,
    };
  }

  private userModerationSelect() {
    return {
      id: true,
      email: true,
      username: true,
      displayName: true,
      moderationStatus: true,
      bannedAt: true,
      bannedUntil: true,
      banReason: true,
    } as const;
  }

  private contentModerationSelect() {
    return {
      id: true,
      moderationStatus: true,
      quarantinedAt: true,
      quarantinedById: true,
      quarantineReason: true,
    } as const;
  }

  private futureDate(value: string, label: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      throw new BadRequestException(`${label} must be in the future`);
    }
    return date;
  }

  private assertStorageKey(value: string) {
    const key = value.trim();
    const hasControlCharacter = [...key].some((character) => character.charCodeAt(0) <= 0x1f);
    if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\') || hasControlCharacter) {
      throw new BadRequestException('Evidence storageKey must be a safe relative object key');
    }
  }

  private excerpt(value: unknown) {
    if (typeof value !== 'string') return null;
    return value.length > 500 ? `${value.slice(0, 497)}...` : value;
  }

  private jsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private canonicalJson(value: unknown) {
    return JSON.stringify(this.canonicalValue(value));
  }

  private canonicalValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => this.canonicalValue(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, this.canonicalValue(item)]));
    }
    return value;
  }

  private isUniqueError(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: string }).code === 'P2002';
  }

  private idempotencyCollision(error: unknown): 'actor-key' | 'request-id' | null {
    if (!this.isUniqueError(error)) return null;
    const meta = (error as { meta?: { modelName?: unknown; target?: unknown } }).meta;
    const modelName = typeof meta?.modelName === 'string' ? meta.modelName.toLowerCase() : null;
    const target = Array.isArray(meta?.target)
      ? meta.target.map((value) => String(value).toLowerCase())
      : [String(meta?.target ?? '').toLowerCase()];
    const sorted = [...target].sort();
    const singleTarget = target.length === 1 ? target[0] : null;
    const idempotencyActorKey = (
      (
        sorted.length === 2
        && (
        (sorted[0] === 'actor_id' && sorted[1] === 'key')
        || (sorted[0] === 'actorid' && sorted[1] === 'key')
        )
      )
      || singleTarget === 'admin_idempotency_records_actor_id_key_key'
    );
    const requestIdField = singleTarget === 'request_id' || singleTarget === 'requestid';
    const requestIdConstraintModels = new Map([
      ['admin_idempotency_records_request_id_key', 'adminidempotencyrecord'],
      ['admin_audit_events_request_id_key', 'adminauditevent'],
      ['admin_outbox_events_request_id_key', 'adminoutboxevent'],
    ]);

    if (
      idempotencyActorKey
      && (
        modelName === 'adminidempotencyrecord'
        || (!modelName && singleTarget === 'admin_idempotency_records_actor_id_key_key')
      )
    ) {
      return 'actor-key';
    }
    if (singleTarget && requestIdConstraintModels.has(singleTarget)) {
      const constraintModel = requestIdConstraintModels.get(singleTarget);
      if (!modelName || modelName === constraintModel) return 'request-id';
      return null;
    }
    if (
      requestIdField
      && modelName
      && [
        'adminidempotencyrecord',
        'adminauditevent',
        'adminoutboxevent',
      ].includes(modelName)
    ) {
      return 'request-id';
    }
    return null;
  }

  private async cleanupExpiredIdempotencyRecords() {
    const expired = await this.prisma.adminIdempotencyRecord.findMany({
      where: { expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    if (expired.length) {
      await this.prisma.adminIdempotencyRecord.deleteMany({
        where: { id: { in: expired.map((row) => row.id) } },
      });
    }
  }
}
