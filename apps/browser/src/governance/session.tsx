import { useAuth } from '@clerk/react';
import { useEffect, useMemo, useState } from 'react';
import type { Tenant } from '../platform-api.js';
import { PlatformApi } from '../platform-api.js';
import type { Group } from './decoders.js';
import { GovernanceApi } from './governance-api.js';

export interface Account {
  loaded: boolean;
  signedIn: boolean;
  groups?: readonly Group[];
  tenants?: readonly Tenant[];
  governanceApi?: GovernanceApi;
  platformApi?: PlatformApi;
  failure?: { error: unknown };
  retry: () => void;
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

export function GovernanceSession({ onChange }: { onChange: (account: Account) => void }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const governanceApi = useMemo(() => new GovernanceApi(getToken), [getToken]);
  const platformApi = useMemo(() => new PlatformApi(getToken), [getToken]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const retry = () => setAttempt((value) => value + 1);
    if (!isLoaded) { onChange({ loaded: false, signedIn: false, retry }); return; }
    if (!isSignedIn) { onChange({ loaded: true, signedIn: false, retry }); return; }
    const controller = new AbortController();
    onChange({ loaded: true, signedIn: true, retry });
    void Promise.all([governanceApi.groups(controller.signal), platformApi.tenants(controller.signal)])
      .then(([groups, tenants]) => onChange({ loaded: true, signedIn: true, groups, tenants, governanceApi, platformApi, retry }))
      .catch((error: unknown) => { if (!isAbort(error)) onChange({ loaded: true, signedIn: true, failure: { error }, retry }); });
    return () => controller.abort();
  }, [isLoaded, isSignedIn, governanceApi, platformApi, attempt, onChange]);
  return null;
}
