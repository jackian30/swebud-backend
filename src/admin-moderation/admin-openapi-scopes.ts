import { AdminScope } from './admin-scopes.decorator';

export const ADMIN_MODERATION_OPERATION_SCOPES = {
  'GET /admin/moderation/v1/reports': AdminScope.ReportsRead,
  'GET /admin/moderation/v1/reports/{type}/{id}/notes': AdminScope.ReportsNotesRead,
  'GET /admin/moderation/v1/reports/{type}/{id}/appeals': AdminScope.AppealsRead,
  'GET /admin/moderation/v1/reports/{type}/{id}/evidence': AdminScope.EvidenceRead,
  'PATCH /admin/moderation/v1/reports/{type}/{id}': AdminScope.ReportsResolve,
  'PATCH /admin/moderation/v1/reports/{type}/{id}/assignment': AdminScope.ReportsAssign,
  'POST /admin/moderation/v1/reports/{type}/{id}/notes': AdminScope.ReportsNotes,
  'POST /admin/moderation/v1/reports/{type}/{id}/escalations': AdminScope.ReportsEscalate,
  'POST /admin/moderation/v1/reports/{type}/{id}/appeals': AdminScope.AppealsWrite,
  'PATCH /admin/moderation/v1/appeals/{id}': AdminScope.AppealsWrite,
  'POST /admin/moderation/v1/reports/{type}/{id}/evidence': AdminScope.EvidenceWrite,
  'PATCH /admin/moderation/v1/evidence/{id}/retention': AdminScope.EvidenceRetention,
  'POST /admin/moderation/v1/users/{id}/ban': AdminScope.UsersBan,
  'POST /admin/moderation/v1/users/{id}/unban': AdminScope.UsersBan,
  'POST /admin/moderation/v1/users/{id}/revoke-sessions': AdminScope.UserSessionsRevoke,
  'POST /admin/moderation/v1/posts/{id}/quarantine': AdminScope.ContentWrite,
  'POST /admin/moderation/v1/posts/{id}/restore': AdminScope.ContentWrite,
  'POST /admin/moderation/v1/groups/{id}/quarantine': AdminScope.ContentWrite,
  'POST /admin/moderation/v1/groups/{id}/restore': AdminScope.ContentWrite,
  'POST /admin/moderation/v1/messages/{id}/quarantine': AdminScope.ContentWrite,
  'POST /admin/moderation/v1/messages/{id}/restore': AdminScope.ContentWrite,
} as const;

export type AdminModerationOperationKey = keyof typeof ADMIN_MODERATION_OPERATION_SCOPES;
