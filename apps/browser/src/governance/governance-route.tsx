import { SignInButton } from '@clerk/react';
import type { Navigate } from '../app-routes.js';
import { useState } from 'react';
import { PlatformApiError } from '../platform-api.js';
import { commandFailure } from './governance-model.js';
import type { InboxNotice } from './approvals-inbox.js';
import { ErrorPage, StatePage } from '../ui.js';
import { AccessBoundary } from './access-boundary.js';
import { CreateGroup, type NewGroup } from './create-group.js';
import type { Group } from './decoders.js';
import { GovernancePage } from './governance-page.js';
import type { GovernanceSource } from './governance-source.js';
import { FIXTURE_GROUP } from './governance-source.js';
import type { PendingApprovals } from './use-pending-approvals.js';
import type { Account } from './session.js';

interface Props { authEnabled: boolean; account: Account; source: GovernanceSource | undefined; pending: PendingApprovals; groupId: string | undefined; setGroupId: (id: string) => void; navigate: Navigate }
const signedOut = new PlatformApiError(401, undefined, 'UNAUTHENTICATED');
const fixtureGroups: readonly Group[] = [FIXTURE_GROUP];

function NewGroupState({ account, navigate }: { account: Account; navigate: Navigate }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<InboxNotice>();
  const admin = account.tenants?.some((tenant) => tenant.profiles.includes('admin')) ?? false;
  if (!admin || account.tenants === undefined) return <AccessBoundary navigate={navigate} />;
  const create = (group: NewGroup): void => {
    if (account.governanceApi === undefined || account.reloadGroups === undefined) return;
    setBusy(true);
    setNotice(undefined);
    account.governanceApi.command({ name: 'create-group', expectedVersion: 0, arguments: { ...group } })
      .then(account.reloadGroups)
      .catch((error: unknown) => { setNotice({ tone: 'warning', text: commandFailure(error, 'create-group') }); })
      .finally(() => { setBusy(false); });
  };
  return <CreateGroup tenants={account.tenants} create={create} busy={busy} notice={notice} />;
}

export function GovernanceRoute({ authEnabled, account, source, pending, groupId, setGroupId, navigate }: Props) {
  if (!authEnabled) return source === undefined ? null : <GovernancePage source={source} groups={fixtureGroups} groupId={FIXTURE_GROUP.id} setGroupId={setGroupId} pending={pending} />;
  if (!account.loaded) return <StatePage busy title="Opening governance">Checking your session…</StatePage>;
  if (!account.signedIn) return <ErrorPage error={signedOut} message="Sign in to see governance for your groups." actions={<SignInButton mode="modal" forceRedirectUrl={location.pathname}><button className="button">Sign in</button></SignInButton>} />;
  if (account.failure !== undefined) return <ErrorPage error={account.failure.error} onRetry={account.retry} />;
  if (account.groups === undefined) return <StatePage busy title="Opening governance">Loading your groups…</StatePage>;
  if (source === undefined || groupId === undefined) return <NewGroupState account={account} navigate={navigate} />;
  return <GovernancePage source={source} groups={account.groups} groupId={groupId} setGroupId={setGroupId} pending={pending} {...(account.platformApi === undefined ? {} : { platformApi: account.platformApi })} {...(account.governanceApi === undefined ? {} : { governanceApi: account.governanceApi })} {...(account.tenants === undefined ? {} : { tenants: account.tenants })} {...(account.reloadGroups === undefined ? {} : { reloadGroups: account.reloadGroups })} />;
}
