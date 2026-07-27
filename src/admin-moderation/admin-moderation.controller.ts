import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ModerationReportType } from '@prisma/client';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { UuidParam } from '../common/uuid-param.decorator';
import { AdminJwtGuard } from './admin-jwt.guard';
import { AdminModerationService } from './admin-moderation.service';
import {
  CurrentAdmin,
  CurrentAdminMutation,
  AdminMutationContext,
  AdminPrincipal,
} from './admin-moderation.types';
import { AdminMutationGuard } from './admin-mutation.guard';
import { AdminScope, RequireAdminScopes } from './admin-scopes.decorator';
import { AdminScopesGuard } from './admin-scopes.guard';
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

function AdminMutation() {
  return applyDecorators(
    UseGuards(AdminMutationGuard),
    ApiHeader({ name: 'X-Request-ID', required: true, schema: { type: 'string', format: 'uuid' } }),
    ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 } }),
  );
}

@ApiTags('Admin moderation')
@ApiBearerAuth('adminBearer')
@UseGuards(AdminJwtGuard, AdminScopesGuard)
@Controller('admin/moderation/v1')
export class AdminModerationController {
  constructor(private readonly moderation: AdminModerationService) {}

  @Get('reports')
  @RequireAdminScopes(AdminScope.ReportsRead)
  reports(@Query() query: AdminReportQueryDto) {
    return this.moderation.reports(query);
  }

  @Get('reports/:type/:id/notes')
  @RequireAdminScopes(AdminScope.ReportsNotesRead)
  internalNotes(
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
  ) {
    return this.moderation.internalNotes(type, reportId);
  }

  @Get('reports/:type/:id/appeals')
  @RequireAdminScopes(AdminScope.AppealsRead)
  appeals(
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
  ) {
    return this.moderation.appeals(type, reportId);
  }

  @Get('reports/:type/:id/evidence')
  @RequireAdminScopes(AdminScope.EvidenceRead)
  evidence(
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
  ) {
    return this.moderation.evidence(type, reportId);
  }

  @Patch('reports/:type/:id')
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ReportsResolve)
  updateReport(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
    @Body() dto: UpdateAdminReportDto,
  ) {
    return this.moderation.updateReport(actor, mutation, type, reportId, dto);
  }

  @Patch('reports/:type/:id/assignment')
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ReportsAssign)
  assignReport(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
    @Body() dto: AssignAdminReportDto,
  ) {
    return this.moderation.assignReport(actor, mutation, type, reportId, dto);
  }

  @Post('reports/:type/:id/notes')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ReportsNotes)
  addInternalNote(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
    @Body() dto: AddAdminReportNoteDto,
  ) {
    return this.moderation.addInternalNote(actor, mutation, type, reportId, dto);
  }

  @Post('reports/:type/:id/escalations')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ReportsEscalate)
  escalateReport(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
    @Body() dto: EscalateAdminReportDto,
  ) {
    return this.moderation.escalateReport(actor, mutation, type, reportId, dto);
  }

  @Post('reports/:type/:id/appeals')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.AppealsWrite)
  createAppeal(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
    @Body() dto: CreateAdminAppealDto,
  ) {
    return this.moderation.createAppeal(actor, mutation, type, reportId, dto);
  }

  @Patch('appeals/:id')
  @AdminMutation()
  @RequireAdminScopes(AdminScope.AppealsWrite)
  reviewAppeal(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') appealId: string,
    @Body() dto: ReviewAdminAppealDto,
  ) {
    return this.moderation.reviewAppeal(actor, mutation, appealId, dto);
  }

  @Post('reports/:type/:id/evidence')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.EvidenceWrite)
  createEvidence(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @Param('type', new ParseEnumPipe(ModerationReportType)) type: ModerationReportType,
    @UuidParam('id') reportId: string,
    @Body() dto: CreateAdminEvidenceDto,
  ) {
    return this.moderation.createEvidence(actor, mutation, type, reportId, dto);
  }

  @Patch('evidence/:id/retention')
  @AdminMutation()
  @RequireAdminScopes(AdminScope.EvidenceRetention)
  updateEvidenceRetention(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') evidenceId: string,
    @Body() dto: UpdateAdminEvidenceRetentionDto,
  ) {
    return this.moderation.updateEvidenceRetention(actor, mutation, evidenceId, dto);
  }

  @Post('users/:id/ban')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.UsersBan)
  banUser(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') userId: string,
    @Body() dto: BanAdminUserDto,
  ) {
    return this.moderation.banUser(actor, mutation, userId, dto);
  }

  @Post('users/:id/unban')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.UsersBan)
  unbanUser(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') userId: string,
    @Body() dto: UnbanAdminUserDto,
  ) {
    return this.moderation.unbanUser(actor, mutation, userId, dto);
  }

  @Post('users/:id/revoke-sessions')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.UserSessionsRevoke)
  revokeUserSessions(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') userId: string,
    @Body() dto: RevokeAdminUserSessionsDto,
  ) {
    return this.moderation.revokeUserSessions(actor, mutation, userId, dto);
  }

  @Post('posts/:id/quarantine')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ContentWrite)
  quarantinePost(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') postId: string,
    @Body() dto: QuarantineAdminContentDto,
  ) {
    return this.moderation.quarantinePost(actor, mutation, postId, dto);
  }

  @Post('posts/:id/restore')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ContentWrite)
  restorePost(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') postId: string,
    @Body() dto: RestoreAdminContentDto,
  ) {
    return this.moderation.restorePost(actor, mutation, postId, dto);
  }

  @Post('groups/:id/quarantine')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ContentWrite)
  quarantineGroup(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') groupId: string,
    @Body() dto: QuarantineAdminContentDto,
  ) {
    return this.moderation.quarantineGroup(actor, mutation, groupId, dto);
  }

  @Post('groups/:id/restore')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ContentWrite)
  restoreGroup(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') groupId: string,
    @Body() dto: RestoreAdminContentDto,
  ) {
    return this.moderation.restoreGroup(actor, mutation, groupId, dto);
  }

  @Post('messages/:id/quarantine')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ContentWrite)
  quarantineMessage(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') messageId: string,
    @Body() dto: QuarantineAdminContentDto,
  ) {
    return this.moderation.quarantineMessage(actor, mutation, messageId, dto);
  }

  @Post('messages/:id/restore')
  @HttpCode(200)
  @AdminMutation()
  @RequireAdminScopes(AdminScope.ContentWrite)
  restoreMessage(
    @CurrentAdmin() actor: AdminPrincipal,
    @CurrentAdminMutation() mutation: AdminMutationContext,
    @UuidParam('id') messageId: string,
    @Body() dto: RestoreAdminContentDto,
  ) {
    return this.moderation.restoreMessage(actor, mutation, messageId, dto);
  }
}
