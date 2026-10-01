import { useEffect, useMemo, useRef, useState } from 'react';
import { gsap, motionAllowed, useGSAP } from '../motion.js';
import SplitText from '../react-bits/SplitText.js';
import { ErrorPage, StatePage, moveTabFocus } from '../ui.js';
import { ApprovalsInbox, type InboxNotice } from './approvals-inbox.js';
import type { Approval, Group, Health, Members, Overview, RangeKey, Series, Workflows } from './decoders.js';
import { approvalCommand, banner, commandFailure, decisionFailure, kpis, rangeName, RANGES } from './governance-model.js';
import type { GovernanceApi } from './governance-api.js';
import { LogsPanel } from './logs-panel.js';
import { TracePanel } from './trace-panel.js';
import { GroupAdminPanel, type RunCommand } from './group-admin-panel.js';
import type { PlatformApi, Tenant } from '../platform-api.js';
import type { PendingApprovals } from './use-pending-approvals.js';
import type { GovernanceSource } from './governance-source.js';
import { KpiRow } from './kpi-row.js';
import { OverviewPanel } from './overview-panel.js';
import { Sparkline } from '../charts/sparkline.js';
import { useSeries } from './use-series.js';

interface Loaded { overview: Overview; workflows: Workflows; health: Health; telemetry: Series }
interface Props { source: GovernanceSource; groups: readonly Group[]; groupId: string; setGroupId: (id: string) => void; pending: PendingApprovals; platformApi?: PlatformApi; governanceApi?: GovernanceApi; tenants?: readonly Tenant[]; reloadGroups?: () => Promise<void> }
type TabId = 'overview' | 'approvals' | 'group' | 'logs' | 'trace';
const decisionNotices: Record<ReturnType<typeof decisionFailure>, string> = {
  conflict: 'This approval was already decided, expired, or changed. The list is up to date.',
  unknown: 'The result is not known yet. The list was reloaded; check it before deciding again.',
  denied: "You can't decide approvals in this workspace.",
  failed: 'The decision could not be sent. The list was reloaded.',
};
const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
const STAGGER_SECONDS = 0.06;

export function GovernancePage({ source, groups, groupId, setGroupId, pending, platformApi, governanceApi, tenants = [], reloadGroups }: Props) {
  const [scope, setScope] = useState<string>();
  const [range, setRange] = useState<RangeKey>('7d');
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<TabId>('overview');
  const [loaded, setLoaded] = useState<Loaded>();
  const [failure, setFailure] = useState<{ error: unknown }>();
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [busyRunId, setBusyRunId] = useState<string>();
  const [notice, setNotice] = useState<InboxNotice>();
  const [members, setMembers] = useState<Members>();
  const [membersReload, setMembersReload] = useState(0);
  const [groupBusy, setGroupBusy] = useState(false);
  const [traceRunId, setTraceRunId] = useState('');
  const [groupNotice, setGroupNotice] = useState<InboxNotice>();
  const body = useRef<HTMLDivElement>(null);
  const entered = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setFailure(undefined);
    void Promise.all([source.overview(range, scope, signal), source.workflows(range, scope, signal), source.health(signal), source.series('api-throughput', range, scope, signal)])
      .then(([overview, workflows, health, telemetry]) => {
        if (signal.aborted) return;
        setLoaded({ overview, workflows, health, telemetry });
        setNames((current) => ({ ...current, ...Object.fromEntries(overview.workspaces.map((workspace) => [workspace.tenantId, workspace.name])) }));
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (isAbort(error) || signal.aborted) return;
        setFailure({ error });
        setLoading(false);
      });
    return () => controller.abort();
  }, [source, range, scope, reload]);

  useEffect(() => {
    if (tab !== 'group') return;
    const controller = new AbortController();
    source.members(controller.signal)
      .then(setMembers)
      .catch((error: unknown) => { if (!isAbort(error) && !controller.signal.aborted) setGroupNotice({ tone: 'danger', text: 'Workspaces and admins could not be loaded.' }); });
    return () => { controller.abort(); };
  }, [source, tab, membersReload]);

  useGSAP(() => {
    if (loaded === undefined || entered.current || !motionAllowed()) return;
    entered.current = true;
    gsap.from('.metric, .governance-card', { y: 12, opacity: 0, duration: 0.4, stagger: STAGGER_SECONDS, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { dependencies: [loaded === undefined], scope: body });

  const runs = useSeries(source, 'runs-over-time', range, scope, reload);
  const runPoints = useMemo(() => {
    const totals = new Map<number, number>();
    for (const line of runs.series?.status === 'ready' ? runs.series.series : []) for (const [t, v] of line.points) totals.set(t, (totals.get(t) ?? 0) + v);
    return [...totals].sort(([a], [b]) => a - b);
  }, [runs.series]);
  const tiles = useMemo(() => loaded === undefined ? [] : kpis(loaded.overview.total), [loaded]);
  const status = loaded === undefined ? undefined : banner(loaded.health, loaded.telemetry.status);
  const tabs: readonly { id: TabId; label: string; badge?: number }[] = [{ id: 'overview', label: 'Overview' }, { id: 'approvals', label: 'Approvals', badge: pending.count }, { id: 'group', label: 'Workspaces & admins' }, { id: 'logs', label: 'Logs' }, { id: 'trace', label: 'Trace' }];
  const decide = (row: Approval, decision: 'approve' | 'reject'): void => {
    if (platformApi === undefined || busyRunId !== undefined) return;
    setBusyRunId(row.runId);
    setNotice(undefined);
    platformApi.command(approvalCommand(row, decision))
      .then(() => { setNotice({ tone: 'success', text: `Run ${row.runId} ${decision === 'approve' ? 'approved' : 'rejected'}.` }); })
      .catch((error: unknown) => { const failure = decisionFailure(error); setNotice({ tone: failure === 'conflict' || failure === 'unknown' ? 'warning' : 'danger', text: decisionNotices[failure] }); })
      .finally(() => { setBusyRunId(undefined); pending.reload(); setReload((value) => value + 1); });
  };
  const openTrace = (runId: string): void => { setTraceRunId(runId); setTab('trace'); };
  const group = groups.find((entry) => entry.id === groupId);
  const runGroup: RunCommand = (name, args) => {
    if (governanceApi === undefined || reloadGroups === undefined || group === undefined || groupBusy) return;
    setGroupBusy(true);
    setGroupNotice(undefined);
    governanceApi.command({ groupId, name, expectedVersion: group.epoch, arguments: args })
      .then(() => { if (name === 'remove-tenant' && args['tenantId'] === scope) setScope(undefined); })
      .catch((error: unknown) => { setGroupNotice({ tone: 'warning', text: commandFailure(error, name, members?.admins.length) }); })
      .then(reloadGroups)
      .catch(() => { setGroupNotice({ tone: 'danger', text: 'The group could not be reloaded. Refresh the page.' }); })
      .finally(() => { setGroupBusy(false); setMembersReload((value) => value + 1); setReload((value) => value + 1); });
  };
  const changeGroup = (id: string) => { setScope(undefined); setNames({}); setLoaded(undefined); setMembers(undefined); setGroupId(id); };

  return (
    <section className="governance-shell">
      <div className="governance-heading">
        <div>
          <p>Governance</p>
          <SplitText tag="h1" text="Governance" animate={motionAllowed()} />
          {source.fixture && <span className="notice notice-info">Fixture data</span>}
        </div>
        <div className="governance-controls">
          {groups.length > 1 && <label className="gov-control">Group<select value={groupId} onChange={(event) => changeGroup(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
          <label className="gov-control">Scope<select value={scope ?? ''} onChange={(event) => setScope(event.target.value === '' ? undefined : event.target.value)}><option value="">All workspaces</option>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label className="gov-control">Range<select value={range} onChange={(event) => setRange(event.target.value as RangeKey)}>{RANGES.map((key) => <option key={key} value={key}>{key} · {rangeName(key)}</option>)}</select></label>
          <button className="button-secondary" onClick={() => setReload((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
      </div>
      {failure !== undefined ? <ErrorPage error={failure.error} onRetry={() => setReload((value) => value + 1)} /> : loaded === undefined || status === undefined ? <StatePage busy title="Loading governance">Reading your group's numbers…</StatePage> : (
        <div ref={body} aria-busy={loading}>
          <div className="health-banner" data-tone={status.tone}><span><i /> {status.text}</span></div>
          <KpiRow tiles={tiles} range={range} extras={{ runs: <Sparkline points={runPoints} label="Runs over the selected period" /> }} />
          <div className="governance-tabs" role="tablist" aria-label="Governance sections" onKeyDown={moveTabFocus}>
            {tabs.map((entry) => <button key={entry.id} role="tab" id={`gov-tab-${entry.id}`} aria-selected={tab === entry.id} aria-controls={`gov-panel-${entry.id}`} tabIndex={tab === entry.id ? 0 : -1} onClick={() => setTab(entry.id)}>{entry.label}{entry.badge !== undefined && entry.badge > 0 && <span className="tab-badge" aria-label={`${String(entry.badge)} pending`}>{entry.badge}</span>}</button>)}
          </div>
          <div role="tabpanel" id={`gov-panel-${tab}`} aria-labelledby={`gov-tab-${tab}`}>
            {tab === 'approvals' && <ApprovalsInbox approvals={pending.approvals} completeness={pending.completeness} decide={decide} busyRunId={busyRunId} notice={notice} canDecide={platformApi !== undefined} />}
            {tab === 'group' && (group === undefined || members === undefined ? <p className="card-empty">{groupNotice?.text ?? 'Loading workspaces and admins…'}</p> : <GroupAdminPanel group={group} members={members} tenants={tenants} run={runGroup} busy={groupBusy} notice={groupNotice} readOnly={governanceApi === undefined} />)}
            {tab === 'logs' && <LogsPanel source={source} scope={scope} range={range} names={names} openTrace={openTrace} />}
            {tab === 'trace' && <TracePanel key={traceRunId} source={source} runId={traceRunId} />}
            {tab === 'overview' && <OverviewPanel overview={loaded.overview} workflows={loaded.workflows} scope={scope} setScope={setScope} source={source} range={range} reload={reload} />}
          </div>
        </div>
      )}
    </section>
  );
}
