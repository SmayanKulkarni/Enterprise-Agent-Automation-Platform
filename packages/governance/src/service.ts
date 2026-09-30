import { AppError } from '../../errors/src/app-error.js';
import type { GroupContext } from '../../identity/src/index.js';
import { fixtureMembers } from './fixtures.js';
import type { AzureSqlGovernanceStore } from './sql.js';

export type GovernanceStore = Pick<AzureSqlGovernanceStore, 'members'>;

export class GovernanceService {
  constructor(private readonly store?: GovernanceStore) {}

  async read(context: GroupContext, collection: string, query: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
    if (collection !== 'members') throw new AppError('NOT_FOUND');
    if (Object.keys(query).length > 0) throw new AppError('INVALID');
    if (this.store === undefined) return { ...fixtureMembers(context), completeness: 'full', classification: 'fixture' };
    return { ...await this.store.members(context), completeness: 'full', classification: 'restricted-operational' };
  }
}
