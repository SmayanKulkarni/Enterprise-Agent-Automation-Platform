import { SignInButton } from '@clerk/react';
import type { Navigate } from '../app-routes.js';
import { PlatformApiError } from '../platform-api.js';
import { ErrorPage, StatePage } from '../ui.js';
import { AccessBoundary } from './access-boundary.js';
import type { Group } from './decoders.js';
import { GovernancePage } from './governance-page.js';
import type { GovernanceSource } from './governance-source.js';
import { FIXTURE_GROUP } from './governance-source.js';
import type { PendingApprovals } from './use-pending-approvals.js';
import type { Account } from './session.js';

interface Props { authEnabled: boolean; account: Account; source: GovernanceSource | undefined; pending: PendingApprovals; groupId: string | undefined; setGroupId: (id: string) => void; navigate: Navigate }
const signedOut = new PlatformApiError(401, undefined, 'UNAUTHENTICATED');
const fixtureGroups: readonly Group[] = [FIXTURE_GROUP];

export function GovernanceRoute({ authEnabled, account, source, pending, groupId, setGroupId, navigate }: Props) {
  if (!authEnabled) return source === undefined ? null : <GovernancePage source={source} groups={fixtureGroups} groupId={FIXTURE_GROUP.id} setGroupId={setGroupId} pending={pending} />;
  if (!account.loaded) return <StatePage busy title="Opening governance">Checking your session…</StatePage>;
  if (!account.signedIn) return <ErrorPage error={signedOut} message="Sign in to see governance for your groups." actions={<SignInButton mode="modal" forceRedirectUrl={location.pathname}><button className="button">Sign in</button></SignInButton>} />;
  if (account.failure !== undefined) return <ErrorPage error={account.failure.error} onRetry={account.retry} />;
  if (account.groups === undefined) return <StatePage busy title="Opening governance">Loading your groups…</StatePage>;
  if (source === undefined || groupId === undefined) {
    const admin = account.tenants?.some((tenant) => tenant.profiles.includes('admin')) ?? false;
    return admin
      ? <StatePage title="Create a group">Governance shows usage and approvals across a group of workspaces you administer. Create a group to start.</StatePage>
      : <AccessBoundary navigate={navigate} />;
  }
  return <GovernancePage source={source} groups={account.groups} groupId={groupId} setGroupId={setGroupId} pending={pending} {...(account.platformApi === undefined ? {} : { platformApi: account.platformApi })} />;
}
