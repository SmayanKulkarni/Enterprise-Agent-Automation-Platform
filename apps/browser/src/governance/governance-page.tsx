import { useEffect, useMemo, useRef, useState } from 'react';
import { gsap, motionAllowed, useGSAP } from '../motion.js';
import SplitText from '../react-bits/SplitText.js';
import { ErrorPage, StatePage, moveTabFocus } from '../ui.js';
import type { Group, Health, Overview, RangeKey, Series, Workflows } from './decoders.js';
import { banner, kpis, rangeName, RANGES } from './governance-model.js';
import type { GovernanceSource } from './governance-source.js';
import { KpiRow } from './kpi-row.js';
import { OverviewPanel } from './overview-panel.js';

interface Loaded { overview: Overview; workflows: Workflows; health: Health; telemetry: Series }
interface Props { source: GovernanceSource; groups: readonly Group[]; groupId: string; setGroupId: (id: string) => void }
type TabId = 'overview';
const tabs: readonly { id: TabId; label: string }[] = [{ id: 'overview', label: 'Overview' }];
const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
const STAGGER_SECONDS = 0.06;

export function GovernancePage({ source, groups, groupId, setGroupId }: Props) {
  const [scope, setScope] = useState<string>();
  const [range, setRange] = useState<RangeKey>('7d');
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<TabId>('overview');
  const [loaded, setLoaded] = useState<Loaded>();
  const [failure, setFailure] = useState<{ error: unknown }>();
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
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

  useGSAP(() => {
    if (loaded === undefined || entered.current || !motionAllowed()) return;
    entered.current = true;
    gsap.from('.metric, .governance-card', { y: 12, opacity: 0, duration: 0.4, stagger: STAGGER_SECONDS, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { dependencies: [loaded === undefined], scope: body });

  const tiles = useMemo(() => loaded === undefined ? [] : kpis(loaded.overview.total), [loaded]);
  const status = loaded === undefined ? undefined : banner(loaded.health, loaded.telemetry.status);
  const changeGroup = (id: string) => { setScope(undefined); setNames({}); setLoaded(undefined); setGroupId(id); };

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
          <KpiRow tiles={tiles} range={range} />
          <div className="governance-tabs" role="tablist" aria-label="Governance sections" onKeyDown={moveTabFocus}>
            {tabs.map((entry) => <button key={entry.id} role="tab" id={`gov-tab-${entry.id}`} aria-selected={tab === entry.id} aria-controls={`gov-panel-${entry.id}`} tabIndex={tab === entry.id ? 0 : -1} onClick={() => setTab(entry.id)}>{entry.label}</button>)}
          </div>
          <div role="tabpanel" id={`gov-panel-${tab}`} aria-labelledby={`gov-tab-${tab}`}>
            {tab === 'overview' && <OverviewPanel overview={loaded.overview} workflows={loaded.workflows} scope={scope} setScope={setScope} />}
          </div>
        </div>
      )}
    </section>
  );
}
