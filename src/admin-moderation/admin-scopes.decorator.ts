import { SetMetadata } from '@nestjs/common';

export const ADMIN_SCOPES = 'admin-moderation:required-scopes';

export const AdminScope = {
  ReportsRead: 'moderation:reports:read',
  ReportsResolve: 'moderation:reports:resolve',
  ReportsAssign: 'moderation:reports:assign',
  ReportsNotesRead: 'moderation:reports:notes:read',
  ReportsNotes: 'moderation:reports:notes',
  ReportsEscalate: 'moderation:reports:escalate',
  AppealsRead: 'moderation:appeals:read',
  AppealsWrite: 'moderation:appeals:write',
  EvidenceRead: 'moderation:evidence:read',
  EvidenceWrite: 'moderation:evidence:write',
  EvidenceRetention: 'moderation:evidence:retention',
  UsersBan: 'moderation:users:ban',
  UserSessionsRevoke: 'moderation:users:sessions:revoke',
  ContentWrite: 'moderation:content:write',
} as const;

export function RequireAdminScopes(...scopes: string[]) {
  return SetMetadata(ADMIN_SCOPES, scopes);
}
