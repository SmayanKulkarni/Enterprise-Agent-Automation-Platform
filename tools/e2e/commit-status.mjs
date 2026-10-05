export const CONTEXT = 'workflow/pr-gate';

const STATES = { accepted: 'success', completed: 'success', returned: 'failure', rejected: 'failure' };
const DESCRIPTIONS = {
  success: 'Gate passed after human approval',
  failure: 'Gate did not pass',
  error: 'Gate did not finish; re-run it',
};
const NAME = /^[A-Za-z0-9_.-]{1,100}$/u;
const SHA = /^[0-9a-f]{7,64}$/iu;
const RUN = /^[0-9a-f-]{36}$/iu;

export const stateFor = (outcome) => STATES[outcome] ?? 'error';

export function statusRequest({ owner, repo, sha, outcome, run, targetBase, context = CONTEXT }) {
  if (!NAME.test(owner) || !NAME.test(repo) || !SHA.test(sha) || typeof outcome !== 'string' || !RUN.test(run)) throw new Error('invalid status request');
  const state = stateFor(outcome);
  return {
    url: `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`,
    body: { state, context, description: `${DESCRIPTIONS[state]} (${outcome})`.slice(0, 140), ...(targetBase ? { target_url: `${targetBase}/#run-${run}` } : {}) },
  };
}
