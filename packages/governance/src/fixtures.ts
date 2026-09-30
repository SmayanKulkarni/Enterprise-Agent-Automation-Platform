export interface FixtureGroupContext { userId: string; tenantIds: readonly string[] }

const FIXTURE_JOINED_AT = '2026-01-01T00:00:00.000Z';

export function fixtureMembers(context: FixtureGroupContext): { workspaces: { tenantId: string; name: string; joinedAt: string; billing: boolean }[]; admins: { userId: string; name: string }[]; eligible: { userId: string; name: string }[] } {
  return {
    workspaces: context.tenantIds.map((tenantId) => ({ tenantId: tenantId, name: `workspace-${tenantId.slice(0, 8)}`, joinedAt: FIXTURE_JOINED_AT, billing: false })),
    admins: [{ userId: context.userId, name: 'Local admin' }],
    eligible: [],
  };
}
