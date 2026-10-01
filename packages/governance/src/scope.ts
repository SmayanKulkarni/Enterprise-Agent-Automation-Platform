import { AppError } from '../../errors/src/app-error.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function tenantPattern(tenantIds: readonly string[]): string {
  if (tenantIds.length === 0 || !tenantIds.every((id) => UUID.test(id))) throw new AppError('INVALID');
  return tenantIds.map((id) => id.toLowerCase()).join('|');
}

export const tenantMatcher = (tenantIds: readonly string[]): string => `tenant_id=~"${tenantPattern(tenantIds)}"`;
