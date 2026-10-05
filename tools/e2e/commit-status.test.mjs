import { expect, test } from 'vitest';
import { CONTEXT, stateFor, statusRequest } from './commit-status.mjs';
import { buildGraph } from './graph-prgate.mjs';

const base = { owner: 'octo', repo: 'demo', sha: 'abc1234', run: '11111111-1111-4111-8111-111111111111' };

test.each([
  ['accepted', 'success'], ['completed', 'success'], ['returned', 'failure'], ['rejected', 'failure'],
  ['expired', 'error'], ['cancelled', 'error'], ['superseded', 'error'], ['failed', 'error'], ['unknown-outcome', 'error'], ['anything-else', 'error'],
])('outcome %s publishes %s', (outcome, state) => {
  expect(stateFor(outcome)).toBe(state);
});

test('the request targets the head sha with the gate context and links to the run', () => {
  const { url, body } = statusRequest({ ...base, outcome: 'rejected', targetBase: 'https://app.example' });
  expect(url).toBe('https://api.github.com/repos/octo/demo/statuses/abc1234');
  expect(body).toMatchObject({ state: 'failure', context: CONTEXT, target_url: `https://app.example/#run-${base.run}` });
  expect(body.description.length).toBeLessThanOrEqual(140);
});

test.each([
  [{ owner: '../x' }], [{ repo: 'a/b' }], [{ sha: 'not-a-sha' }], [{ run: 'x' }], [{ outcome: 5 }],
])('invalid input %j is refused before any request is built', (patch) => {
  expect(() => statusRequest({ ...base, outcome: 'accepted', ...patch })).toThrow('invalid status request');
});

test('the gate graph publishes a status for every terminal outcome and supersedes by pull request', () => {
  const grants = Object.fromEntries(['t_diff', 't_commit', 'merge', 'issue', 'status'].map((id) => [id, `g-${id}`]));
  const graph = buildGraph({ installation: { id: 'i1', digest: 'd' }, grants, status: { installation: { id: 'i2', digest: 'd2' }, grant: 'g-status' } });
  const trigger = graph.nodes.find((node) => node.kind === 'trigger');
  expect(trigger.config).toMatchObject({ subjectKey: ['owner', 'repo', 'pullNumber'], subjectVersion: 'headSha' });
  expect(graph.edges).toContainEqual(expect.objectContaining({ from: trigger.id, to: 'status', role: 'finalizer' }));
  expect(graph.nodes.find((node) => node.id === 'status').config.arguments).toEqual({ owner: '$input.owner', repo: '$input.repo', sha: '$input.headSha', outcome: '$run.outcome', run: '$run.id' });
  expect(Object.fromEntries(graph.nodes.filter((node) => node.kind === 'end').map((node) => [node.id, node.config.outcome]))).toEqual({ end_merged: 'accepted', end_commit_ok: 'accepted', end_returned: 'returned' });
});

test('without a status installation the graph is unchanged apart from subject and outcomes', () => {
  const graph = buildGraph({ installation: { id: 'i1', digest: 'd' }, grants: {} });
  expect(graph.nodes.some((node) => node.id === 'status')).toBe(false);
  expect(graph.edges.some((edge) => edge.role === 'finalizer')).toBe(false);
});
