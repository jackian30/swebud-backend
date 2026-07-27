import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminMutationGuard } from './admin-mutation.guard';
import { ADMIN_MODERATION_OPERATION_SCOPES } from './admin-openapi-scopes';
import { ADMIN_SCOPES, AdminScope } from './admin-scopes.decorator';

describe('AdminModerationController route policy', () => {
  const prototype = AdminModerationController.prototype as any;

  it.each([
    ['reports', AdminScope.ReportsRead],
    ['internalNotes', AdminScope.ReportsNotesRead],
    ['appeals', AdminScope.AppealsRead],
    ['evidence', AdminScope.EvidenceRead],
    ['updateReport', AdminScope.ReportsResolve],
    ['assignReport', AdminScope.ReportsAssign],
    ['addInternalNote', AdminScope.ReportsNotes],
    ['escalateReport', AdminScope.ReportsEscalate],
    ['createAppeal', AdminScope.AppealsWrite],
    ['reviewAppeal', AdminScope.AppealsWrite],
    ['createEvidence', AdminScope.EvidenceWrite],
    ['updateEvidenceRetention', AdminScope.EvidenceRetention],
    ['banUser', AdminScope.UsersBan],
    ['unbanUser', AdminScope.UsersBan],
    ['revokeUserSessions', AdminScope.UserSessionsRevoke],
    ['quarantinePost', AdminScope.ContentWrite],
    ['restorePost', AdminScope.ContentWrite],
    ['quarantineGroup', AdminScope.ContentWrite],
    ['restoreGroup', AdminScope.ContentWrite],
    ['quarantineMessage', AdminScope.ContentWrite],
    ['restoreMessage', AdminScope.ContentWrite],
  ])('%s requires only its designated scope', (method, scope) => {
    expect(Reflect.getMetadata(ADMIN_SCOPES, prototype[method])).toEqual([scope]);
  });

  it('keeps the OpenAPI operation-scope inventory exactly aligned with route metadata', () => {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, AdminModerationController) as string;
    const actual: Record<string, string> = {};
    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === 'constructor') continue;
      const handler = prototype[methodName] as Function;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      const routePath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (requestMethod === undefined || routePath === undefined) continue;
      const method = RequestMethod[requestMethod];
      const path = `/${controllerPath}/${routePath}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const scopes = Reflect.getMetadata(ADMIN_SCOPES, handler) as string[] | undefined;
      expect(scopes).toHaveLength(1);
      actual[`${method} ${path}`] = scopes![0];
    }

    expect(actual).toEqual(ADMIN_MODERATION_OPERATION_SCOPES);
  });

  it.each([
    'updateReport',
    'assignReport',
    'addInternalNote',
    'escalateReport',
    'createAppeal',
    'reviewAppeal',
    'createEvidence',
    'updateEvidenceRetention',
    'banUser',
    'unbanUser',
    'revokeUserSessions',
    'quarantinePost',
    'restorePost',
    'quarantineGroup',
    'restoreGroup',
    'quarantineMessage',
    'restoreMessage',
  ])('%s requires mutation correlation and idempotency headers', (method) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, prototype[method]) ?? [];
    expect(guards).toContain(AdminMutationGuard);
  });
});
