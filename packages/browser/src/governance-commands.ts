import type { AzureSqlGovernanceStore, GroupTenantCommand } from '../../governance/src/sql.js';
import type { GroupCommand, GroupCommandHandler } from './index.js';

type GovernanceStore = Pick<AzureSqlGovernanceStore, 'createGroup' | 'command'>;

const receipt = (command: GroupCommand, objectId: string, state: string): Record<string, unknown> => ({ commandId: command.idempotencyKey, objectId, revision: command.expectedVersion + 1, state, digest: command.digest, evidenceIds: [] });

export function governanceCommandHandlers(store: GovernanceStore): Record<string, GroupCommandHandler> {
  const tenantCommand = (name: GroupTenantCommand, state: string): GroupCommandHandler => async (command) => {
    const group = command.group; if (group === undefined) throw Object.assign(new Error('DENIED'), { code: 'DENIED' });
    return (await store.command(name, group, command.expectedVersion, command.arguments, command.idempotencyKey, command.digest, receipt(command, group.groupId, state))).receipt;
  };
  return {
    'governance.create-group': async (command) => {
      const { name, tenantIds, billingTenantId } = command.arguments as { name: string; tenantIds: string[]; billingTenantId: string | null };
      return (await store.createGroup(command.userId, { name, tenantIds, billingTenantId }, command.idempotencyKey, command.digest, receipt(command, command.idempotencyKey, 'active'))).receipt;
    },
    'governance.add-tenant': tenantCommand('add-tenant', 'tenant-added'),
    'governance.remove-tenant': tenantCommand('remove-tenant', 'tenant-removed'),
  };
}
