import type { AzureSqlGovernanceStore, GroupCommandName } from '../../governance/src/sql.js';
import type { GroupCommand, GroupCommandHandler } from './index.js';

type GovernanceStore = Pick<AzureSqlGovernanceStore, 'createGroup' | 'command'>;

const receipt = (command: GroupCommand, objectId: string, state: string): Record<string, unknown> => ({ commandId: command.idempotencyKey, objectId, revision: command.expectedVersion + 1, state, digest: command.digest, evidenceIds: [] });

export function governanceCommandHandlers(store: GovernanceStore): Record<string, GroupCommandHandler> {
  const groupCommand = (name: GroupCommandName, state: string): GroupCommandHandler => async (command) => {
    const group = command.group; if (group === undefined) throw Object.assign(new Error('DENIED'), { code: 'DENIED' });
    return (await store.command(name, group, command.expectedVersion, command.arguments, command.idempotencyKey, command.digest, receipt(command, group.groupId, state))).receipt;
  };
  return {
    'governance.create-group': async (command) => {
      const { name, tenantIds, billingTenantId } = command.arguments as { name: string; tenantIds: string[]; billingTenantId: string | null };
      return (await store.createGroup(command.userId, { name, tenantIds, billingTenantId }, command.idempotencyKey, command.digest, receipt(command, command.idempotencyKey, 'active'))).receipt;
    },
    'governance.add-tenant': groupCommand('add-tenant', 'tenant-added'),
    'governance.remove-tenant': groupCommand('remove-tenant', 'tenant-removed'),
    'governance.add-admin': groupCommand('add-admin', 'admin-added'),
    'governance.remove-admin': groupCommand('remove-admin', 'admin-removed'),
    'governance.set-billing-tenant': groupCommand('set-billing-tenant', 'billing-set'),
  };
}
