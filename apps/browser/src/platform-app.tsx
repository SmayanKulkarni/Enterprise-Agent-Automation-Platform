import { UserButton, useUser } from '@clerk/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { paths, routeFromPath, scrollBehavior, titles, type Navigate, type Route } from './app-routes.js';
import { Landing } from './landing.js';
import { SignIn } from './sign-in.js';
import { GovernanceRoute } from './governance/governance-route.js';
import { GovernanceSession, type Account } from './governance/session.js';
import { fixtureSource, liveSource } from './governance/governance-source.js';
import { usePendingApprovals } from './governance/use-pending-approvals.js';
import { AuthenticatedStudio, StudioEditor } from './studio-editor.js';
import { PageBoundary, StatePage } from './ui.js';
import { ThemeToggle } from './theme.js';

export function App({ authEnabled }: { authEnabled: boolean }) {
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));
  const [account, setAccount] = useState<Account>({ loaded: false, signedIn: false, retry: () => undefined });
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const onAccount = useCallback((next: Account) => setAccount(next), []);
  const groups = account.groups ?? [];
  const groupId = groups.find((group) => group.id === selectedGroupId)?.id ?? groups[0]?.id;
  const governanceApi = account.governanceApi;
  const source = useMemo(() => !authEnabled ? fixtureSource() : governanceApi !== undefined && groupId !== undefined ? liveSource(governanceApi, groupId) : undefined, [authEnabled, governanceApi, groupId]);
  const pending = usePendingApprovals(source);
  const mainRef = useRef<HTMLElement>(null);
  const initial = useRef(true);
  useEffect(() => { const restore = () => setRoute(routeFromPath(window.location.pathname)); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, []);
  useEffect(() => { document.title = titles[route]; if (!initial.current) mainRef.current?.focus(); initial.current = false; }, [route]);
  const navigate: Navigate = (next) => { window.history.pushState(null, '', paths[next]); setRoute(next); window.scrollTo({ top: 0, behavior: scrollBehavior() }); };
  return <div className="app-frame">{authEnabled && <GovernanceSession onChange={onAccount} />}<a className="skip-link" href="#main-content">Skip to content</a><TopBar route={route} showGovernance={!authEnabled || groups.length > 0} pendingCount={pending.count} authEnabled={authEnabled} navigate={navigate} /><main id="main-content" tabIndex={-1} ref={mainRef}><PageBoundary key={route}>{route === 'home' && <Landing navigate={navigate} authEnabled={authEnabled} />}{route === 'studio' && (authEnabled ? <AuthenticatedStudio /> : <StudioEditor />)}{route === 'governance' && <GovernanceRoute authEnabled={authEnabled} account={account} source={source} pending={pending} groupId={groupId} setGroupId={setSelectedGroupId} navigate={navigate} />}{route === 'signin' && <SignIn authEnabled={authEnabled} navigate={navigate} />}{route === 'not-found' && <StatePage title="Page not found" actions={<><a className="button" href="/">Home</a><button className="button-secondary" onClick={() => navigate('studio')}>Open Studio</button></>}>We couldn't find {window.location.pathname}.</StatePage>}</PageBoundary></main></div>;
}

function TopBar({ route, showGovernance, pendingCount, authEnabled, navigate }: { route: Route; showGovernance: boolean; pendingCount: number; authEnabled: boolean; navigate: Navigate }) {
  const product = route === 'studio' || route === 'governance';
  return <header className={product ? 'topbar topbar-product' : 'topbar'}><button className="wordmark" onClick={() => navigate('home')} aria-label="Threadline home"><span className="brand-mark"><i /><i /><i /></span><span>threadline</span></button><nav aria-label="Primary navigation"><button className={route === 'studio' ? 'active' : ''} onClick={() => navigate('studio')}>Studio</button>{showGovernance && <button className={route === 'governance' ? 'active' : ''} onClick={() => navigate('governance')}>Governance{pendingCount > 0 && <span className="nav-badge" role="img" aria-label={`${String(pendingCount)} pending approvals`}>{pendingCount}</span>}</button>}{route === 'home' && <a href="#platform">Platform</a>}</nav><div className="topbar-actions"><ThemeToggle />{product && <span className="workspace-switcher">{authEnabled ? 'Authenticated workspace' : 'Fixture workspace'}</span>}{authEnabled ? <ClerkAccount navigate={navigate} /> : <button className="text-button" onClick={() => navigate('signin')}>Sign in</button>}{!product && <button className="button button-small" onClick={() => navigate('studio')}>Open studio</button>}</div></header>;
}
function ClerkAccount({ navigate }: { navigate: Navigate }) { const { isSignedIn } = useUser(); return isSignedIn ? <UserButton /> : <button className="text-button" onClick={() => navigate('signin')}>Sign in</button>; }
