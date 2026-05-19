export function normalizeUsername(username?: string) {
  return username?.toLowerCase().replace(/^@/, '').trim().replace(/[^a-z0-9._-]/g, '') ?? '';
}
