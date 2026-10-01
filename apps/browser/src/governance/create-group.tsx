import { useState, type FormEvent } from 'react';
import type { Tenant } from '../platform-api.js';
import { Field, Notice } from '../ui.js';
import type { InboxNotice } from './approvals-inbox.js';
import { MAX_GROUP_WORKSPACES, shortId } from './governance-model.js';

const MAX_NAME_LENGTH = 128;
export interface NewGroup { name: string; tenantIds: string[]; billingTenantId: string | null }
interface Props { tenants: readonly Tenant[]; create: (group: NewGroup) => void; busy: boolean; notice: InboxNotice | undefined }

export function CreateGroup({ tenants, create, busy, notice }: Props) {
  const [name, setName] = useState('');
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [billing, setBilling] = useState('');
  const admin = tenants.filter((tenant) => tenant.profiles.includes('admin'));
  const chosenBilling = ticked.includes(billing) ? billing : '';
  const ready = name.trim() !== '' && ticked.length > 0 && ticked.length <= MAX_GROUP_WORKSPACES;
  const toggle = (id: string, on: boolean) => { setTicked((current) => on ? [...current, id] : current.filter((entry) => entry !== id)); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (ready && !busy) create({ name: name.trim(), tenantIds: [...ticked], billingTenantId: chosenBilling === '' ? null : chosenBilling }); };
  return (
    <section className="state-page create-group">
      <h1>Create a group</h1>
      <p>Governance shows usage and approvals across a group of workspaces you administer. Create a group to start.</p>
      {notice !== undefined && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <form onSubmit={submit}>
        <Field label="Group name"><input value={name} required maxLength={MAX_NAME_LENGTH} onChange={(event) => { setName(event.target.value); }} /></Field>
        <fieldset disabled={busy}>
          <legend>Workspaces you administer</legend>
          {admin.map((tenant) => <label key={tenant.id} className="check-row"><input type="checkbox" checked={ticked.includes(tenant.id)} onChange={(event) => { toggle(tenant.id, event.target.checked); }} /> {shortId(tenant.id)}</label>)}
        </fieldset>
        <Field label="Billing workspace (optional)"><select value={chosenBilling} disabled={busy} onChange={(event) => { setBilling(event.target.value); }}><option value="">None</option>{ticked.map((id) => <option key={id} value={id}>{shortId(id)}</option>)}</select></Field>
        <button className="button" type="submit" disabled={!ready || busy}>Create group</button>
      </form>
    </section>
  );
}
