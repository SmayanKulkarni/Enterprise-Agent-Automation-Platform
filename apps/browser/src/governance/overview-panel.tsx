import { Notice } from '../ui.js';
import type { Overview, Workflows } from './decoders.js';
import { dataNotes, formatCount, formatPercent, formatSeconds, formatUsd, successRateOf } from './governance-model.js';

interface Props { overview: Overview; workflows: Workflows; setScope: (tenantId: string) => void; scope: string | undefined }

export function OverviewPanel({ overview, workflows, scope, setScope }: Props) {
  return (
    <>
      {dataNotes(overview, workflows).map((note) => <Notice key={note} tone="info">{note}</Notice>)}
      <div className="governance-stack">
        <article className="governance-card">
          <div className="card-heading"><div><h2>Workspaces</h2><p>Select a workspace to scope the page to it</p></div></div>
          {overview.workspaces.length === 0 ? <p className="card-empty">No workspaces in this group yet.</p> : (
            <table className="data-table">
              <caption className="visually-hidden">Workspace comparison</caption>
              <thead><tr><th scope="col">Workspace</th><th scope="col">Runs</th><th scope="col">Success rate</th><th scope="col">p95</th><th scope="col">Tokens</th><th scope="col">Spend</th><th scope="col">Pending</th></tr></thead>
              <tbody>
                {overview.workspaces.map((workspace) => (
                  <tr key={workspace.tenantId}>
                    <th scope="row"><button className="inline-link" aria-pressed={scope === workspace.tenantId} onClick={() => setScope(workspace.tenantId)}>{workspace.name}</button></th>
                    <td data-label="Runs">{formatCount(workspace.runs)}</td>
                    <td data-label="Success rate">{formatPercent(successRateOf(workspace))}</td>
                    <td data-label="p95">{formatSeconds(workspace.p95Seconds)}</td>
                    <td data-label="Tokens">{formatCount(workspace.tokens)}</td>
                    <td data-label="Spend">{formatUsd(workspace.cost)}</td>
                    <td data-label="Pending">{formatCount(workspace.pendingApprovals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
        <article className="governance-card">
          <div className="card-heading"><div><h2>Workflow portfolio</h2><p>Usage and health by workflow</p></div></div>
          {workflows.workflows.length === 0 ? <p className="card-empty">No workflow runs in this period.</p> : (
            <table className="data-table">
              <caption className="visually-hidden">Workflow portfolio</caption>
              <thead><tr><th scope="col">Workflow</th><th scope="col">Workspace</th><th scope="col">Runs</th><th scope="col">Success rate</th><th scope="col">p95</th><th scope="col">Spend</th></tr></thead>
              <tbody>
                {workflows.workflows.map((workflow) => (
                  <tr key={`${workflow.tenantId}:${workflow.definitionId}`}>
                    <th scope="row">{workflow.name}</th>
                    <td data-label="Workspace">{workflow.workspace}</td>
                    <td data-label="Runs">{formatCount(workflow.runs)}</td>
                    <td data-label="Success rate">{formatPercent(workflow.successRate)}</td>
                    <td data-label="p95">{formatSeconds(workflow.p95Seconds)}</td>
                    <td data-label="Spend">{formatUsd(workflow.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      </div>
    </>
  );
}
