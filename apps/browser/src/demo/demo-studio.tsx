import { useMemo, useState } from 'react';
import type { DemoRun } from '../../../../packages/workflow/src/pr-gate-demo.js';
import { demoGraph } from '../../../../packages/workflow/src/pr-gate-demo.js';
import { PR_GATE_DEFAULT_MODEL } from '../../../../packages/workflow/src/pr-gate-template.js';
import { StudioEditor, type StudioDemo } from '../studio-editor.js';
import type { WorkflowEdge, WorkflowNode } from '../workflow-model.js';
import { RunDialog } from './run-dialog.js';

const OFFSET = { x: 130, y: 90 };
const MODELS = [{ id: PR_GATE_DEFAULT_MODEL, name: PR_GATE_DEFAULT_MODEL, contextLength: 128000, structuredOutput: true, tools: true }];

interface Props { run: DemoRun | undefined; onRun: (run: DemoRun) => void; openGovernance: () => void }

function Banner({ run, openGovernance }: { run: DemoRun | undefined; openGovernance: () => void }) {
  return <section className="demo-banner" aria-label="Demo workspace">
    <div>
      <strong>Demo workspace</strong>
      <span>The PR gate workflow is loaded read-only with every setting filled in except credentials. Starting it runs it once on the server with one model call to review the diff, and the run is stored for 30 days. One run per IP address.</span>
    </div>
    {run !== undefined && <div className="demo-result">
      <h2>{run.verdict.accept ? 'Reviewer suggests accepting' : 'Reviewer suggests returning'} {run.pullRequest.owner}/{run.pullRequest.repo}#{run.pullRequest.pullNumber}</h2>
      <p>{run.verdict.summary} The run now waits for a human decision.</p>
      {run.verdict.findings.length > 0 && <ul>{run.verdict.findings.map((finding) => <li key={`${finding.file}:${String(finding.line)}:${finding.problem}`}><code>{finding.file}:{finding.line}</code> {finding.problem} {finding.fix}</li>)}</ul>}
      <ol className="demo-steps">{run.steps.map((step) => <li key={step.nodeId} data-state={step.state}><b>{step.title}</b> <span>{step.state === 'waiting' ? 'waiting for a human' : 'done'}</span></li>)}</ol>
      <button className="button" onClick={openGovernance}>See this run in Governance</button>
    </div>}
  </section>;
}

export function DemoStudio({ run, onRun, openGovernance }: Props) {
  const [starting, setStarting] = useState(false);
  const graph = useMemo(() => demoGraph(), []);
  const states = useMemo(() => Object.fromEntries((run?.steps ?? []).map((step) => [step.nodeId, step.state])), [run]);
  const demo: StudioDemo = {
    nodes: (graph.nodes as WorkflowNode[]).map((node) => ({ ...node, x: node.x + OFFSET.x, y: node.y + OFFSET.y })), edges: graph.edges as WorkflowEdge[], selected: 'reviewer', states, models: MODELS,
    start: () => setStarting(true), startLabel: run === undefined ? 'Start workflow' : 'Demo run used', startDisabled: run !== undefined,
    banner: <Banner run={run} openGovernance={openGovernance} />,
  };
  return <>
    <StudioEditor demo={demo} />
    {starting && <RunDialog onClose={() => setStarting(false)} onRun={(next) => { setStarting(false); onRun(next); }} />}
  </>;
}
