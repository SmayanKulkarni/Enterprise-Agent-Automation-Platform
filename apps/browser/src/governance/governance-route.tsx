import { SignInButton } from '@clerk/react';
import { useMemo } from 'react';
import type { Navigate } from '../app-routes.js';
import { PlatformApiError } from '../platform-api.js';
import { ErrorPage, StatePage } from '../ui.js';
import { AccessBoundary } from './access-boundary.js';
import type { Group } from './decoders.js';
import { GovernancePage } from './governance-page.js';
import { FIXTURE_GROUP, fixtureSource, liveSource } from './governance-source.js';
import type { Account } from './session.js';

interface Props { authEnabled: boolean; account: Account; groupId: string | undefined; setGroupId: (id: string) => void; navigate: Navigate }
const signedOut = new PlatformApiError(401, undefined, 'UNAUTHENTICATED');
const fixtureGroups: readonly Group[] = [FIXTURE_GROUP];

export function GovernanceRoute({ authEnabled, account, groupId, setGroupId, navigate }: Props) {
  const fixture = useMemo(() => fixtureSource(), []);
  const live = useMemo(() => account.governanceApi !== undefined && groupId !== undefined ? liveSource(account.governanceApi, groupId) : undefined, [account.governanceApi, groupId]);
  if (!authEnabled) return <GovernancePage source={fixture} groups={fixtureGroups} groupId={FIXTURE_GROUP.id} setGroupId={setGroupId} />;
  if (!account.loaded) return <StatePage busy title="Opening governance">Checking your session…</StatePage>;
  if (!account.signedIn) return <ErrorPage error={signedOut} message="Sign in to see governance for your groups." actions={<SignInButton mode="modal" forceRedirectUrl={location.pathname}><button className="button">Sign in</button></SignInButton>} />;
  if (account.failure !== undefined) return <ErrorPage error={account.failure.error} onRetry={account.retry} />;
  if (account.groups === undefined) return <StatePage busy title="Opening governance">Loading your groups…</StatePage>;
  if (live === undefined || groupId === undefined) {
    const admin = account.tenants?.some((tenant) => tenant.profiles.includes('admin')) ?? false;
    return admin
      ? <StatePage title="Create a group">Governance shows usage and approvals across a group of workspaces you administer. Create a group to start.</StatePage>
      : <AccessBoundary navigate={navigate} />;
  }
  return <GovernancePage source={live} groups={account.groups} groupId={groupId} setGroupId={setGroupId} />;
}
