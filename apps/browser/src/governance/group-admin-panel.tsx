import { useState } from 'react';
import { formatMoment } from '../charts/scale.js';
import type { Tenant } from '../platform-api.js';
import { Dialog, Notice } from '../ui.js';
import type { InboxNotice } from './approvals-inbox.js';
import type { Group, Members } from './decoders.js';
import type { GroupCommandName } from './governance-api.js';
import { addableWorkspaces, MAX_GROUP_ADMINS, MAX_GROUP_WORKSPACES, shortId } from './governance-model.js';

export type RunCommand = (name: GroupCommandName, args: Record<string, unknown>) => void;
interface Props { group: Group; members: Members; tenants: readonly Tenant[]; run: RunCommand; busy: boolean; notice: InboxNotice | undefined; readOnly: boolean }
interface Removal { name: 'remove-tenant' | 'remove-admin'; args: Record<string, unknown>; title: string; consequence: string }

const WORKSPACE_CONSEQUENCE = 'Group admins lose the access they received through this group. People who were admins of this workspace before keep their access.';
const ADMIN_CONSEQUENCE = 'This person loses admin access to every workspace they received through this group.';

function AddRow({ label, options, disabled, reason, onAdd }: { label: string; options: readonly { value: string; text: string }[]; disabled: boolean; reason: string | undefined; onAdd: (value: string) => void }) {
  const [picked, setPicked] = useState('');
  const blocked = disabled || reason !== undefined;
  return (
    <div className="group-add">
      <label className="gov-control">{label}<select value={picked} disabled={blocked} onChange={(event) => { setPicked(event.target.value); }}><option value="">Choose…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.text}</option>)}</select></label>
      <button className="button button-small" disabled={blocked || picked === ''} onClick={() => { onAdd(picked); setPicked(''); }}>Add</button>
      {reason !== undefined && <small>{reason}</small>}
    </div>
  );
}

export function GroupAdminPanel({ group, members, tenants, run, busy, notice, readOnly }: Props) {
  const [removal, setRemoval] = useState<Removal>();
  const locked = busy || readOnly;
  const lastAdmin = members.admins.length <= 1;
  const billing = members.workspaces.find((workspace) => workspace.billing)?.tenantId ?? '';
  const workspaceReason = members.workspaces.length >= MAX_GROUP_WORKSPACES ? `A group can have at most ${String(MAX_GROUP_WORKSPACES)} workspaces.` : undefined;
  const adminReason = members.admins.length >= MAX_GROUP_ADMINS ? `A group can have at most ${String(MAX_GROUP_ADMINS)} admins.` : undefined;
  return (
    <section className="group-admin" aria-label="Workspaces and admins" aria-busy={busy}>
      {notice !== undefined && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {readOnly && <Notice>Fixture data is read only.</Notice>}
      <div className="governance-card group-section">
        <h2>Workspaces</h2>
        <ul>
          {members.workspaces.map((workspace) => (
            <li key={workspace.tenantId}>
              <span>{workspace.name}{workspace.billing && <span className="status-chip"> Billing</span>}</span>
              <small>Joined {formatMoment(Date.parse(workspace.joinedAt))}</small>
              <button className="button-secondary button-small" disabled={locked} onClick={() => { setRemoval({ name: 'remove-tenant', args: { tenantId: workspace.tenantId }, title: `Remove ${workspace.name} from the group?`, consequence: WORKSPACE_CONSEQUENCE }); }}>Remove<span className="visually-hidden">{` ${workspace.name}`}</span></button>
            </li>
          ))}
        </ul>
        <AddRow label="Add workspace" options={addableWorkspaces(tenants, group).map((id) => ({ value: id, text: shortId(id) }))} disabled={locked} reason={workspaceReason} onAdd={(tenantId) => { run('add-tenant', { tenantId }); }} />
        <label className="gov-control">Billing workspace<select value={billing} disabled={locked || members.workspaces.length === 0} onChange={(event) => { if (event.target.value !== '') run('set-billing-tenant', { tenantId: event.target.value }); }}><option value="">None</option>{members.workspaces.map((workspace) => <option key={workspace.tenantId} value={workspace.tenantId}>{workspace.name}</option>)}</select></label>
      </div>
      <div className="governance-card group-section">
        <h2>Admins</h2>
        <ul>
          {members.admins.map((admin) => (
            <li key={admin.userId}>
              <span>{admin.name}</span>
              <button className="button-secondary button-small" disabled={locked || lastAdmin} onClick={() => { setRemoval({ name: 'remove-admin', args: { userId: admin.userId }, title: `Remove ${admin.name} as admin?`, consequence: ADMIN_CONSEQUENCE }); }}>Remove<span className="visually-hidden">{` ${admin.name}`}</span></button>
            </li>
          ))}
        </ul>
        {lastAdmin && <small>A group must keep at least one admin.</small>}
        <AddRow label="Add admin" options={members.eligible.map((person) => ({ value: person.userId, text: person.name }))} disabled={locked} reason={adminReason} onAdd={(userId) => { run('add-admin', { userId }); }} />
      </div>
      {removal !== undefined && (
        <Dialog labelledBy="group-remove-title" onClose={() => { setRemoval(undefined); }} className="reject-dialog">
          <h2 id="group-remove-title">{removal.title}</h2>
          <p>{removal.consequence}</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => { const chosen = removal; setRemoval(undefined); run(chosen.name, chosen.args); }}>Remove</button>
            <button className="button-secondary" onClick={() => { setRemoval(undefined); }}>Cancel</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
