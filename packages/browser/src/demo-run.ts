import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { logEvent } from '../../telemetry/src/events.js';
import { count } from '../../telemetry/src/instruments.js';
import { reported } from '../../errors/src/swallow.js';
import { DEMO_MAX_DIFF_BYTES, SAMPLE_DIFF, SAMPLE_PULL_REQUEST, parseVerdict, runDemo, type DemoPullRequest, type DemoRun, type DemoVerdict } from '../../workflow/src/pr-gate-demo.js';

const MAX_BODY_CHARS = 2048;
const GITHUB_TIMEOUT_MS = 8000;
const TOKEN = /^[A-Za-z0-9_]{20,255}$/u;
const PULL_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/pull\/(\d{1,7})\/?$/u;
const SHA = /^[0-9a-f]{7,64}$/u;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/u;

export interface DemoRunDeps {
  claimed(key: string): Promise<boolean>;
  claim(key: string): Promise<boolean>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  review?: ((diff: string) => Promise<unknown>) | undefined;
  now(): number;
  id(): string;
  pepper: string;
}
export interface DemoRunRequest { ip: string | undefined; body: string }
export interface DemoRunReply { status: number; body: { run: DemoRun } | { error: { code: string; message: string } } }

const fail = (status: number, code: string, message: string): DemoRunReply => ({ status, body: { error: { code, message } } });
const unavailable = (): DemoRunReply => fail(503, 'DEMO_UNAVAILABLE', 'The demo is temporarily unavailable.');
const used = (): DemoRunReply => fail(429, 'DEMO_RUN_USED', 'This address has already used its one demo run.');
const invalid = (message: string): DemoRunReply => fail(400, 'INVALID_INPUT', message);

export const claimKey = (ip: string, pepper: string): string => createHmac('sha256', pepper).update(ip).digest('hex').slice(0, 32);

export function clientIp(forwardedFor: string | null | undefined): string | undefined {
  const last = forwardedFor?.split(',').at(-1)?.trim();
  if (!last) return undefined;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/u.exec(last)?.[1];
  const candidate = bracketed ?? (/^[^:]+:\d+$/u.test(last) ? last.slice(0, last.lastIndexOf(':')) : last);
  return isIP(candidate) === 0 ? undefined : candidate;
}

interface Input { githubToken?: string; pullRequest?: string }

function parseInput(body: string): Input | undefined {
  if (body.length > MAX_BODY_CHARS) return undefined;
  let parsed: unknown;
  try { parsed = body.trim() === '' ? {} : JSON.parse(body); } catch { return undefined; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const { githubToken, pullRequest } = parsed as Record<string, unknown>;
  if (githubToken !== undefined && typeof githubToken !== 'string' || pullRequest !== undefined && typeof pullRequest !== 'string') return undefined;
  const token = githubToken === '' ? undefined : githubToken;
  const pull = pullRequest === '' ? undefined : pullRequest;
  if (token === undefined !== (pull === undefined)) return undefined;
  if (token !== undefined && !TOKEN.test(token)) return undefined;
  return { ...(token === undefined ? {} : { githubToken: token }), ...(pull === undefined ? {} : { pullRequest: pull }) };
}

class GithubFailure extends Error { constructor(readonly reply: DemoRunReply) { super('GITHUB'); } }

async function readGithub(deps: DemoRunDeps, token: string, owner: string, repo: string, pullNumber: number): Promise<{ pullRequest: DemoPullRequest; diff: string }> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${String(pullNumber)}`;
  const get = async (accept: string): Promise<Response> => {
    let response: Response;
    try {
      response = await deps.fetch(url, { headers: { authorization: `Bearer ${token}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'threadline-demo' }, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS), redirect: 'error' });
    } catch { throw new GithubFailure(fail(502, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached. Try again.')); }
    if ([401, 403, 404].includes(response.status)) throw new GithubFailure(fail(422, 'GITHUB_REJECTED', 'GitHub did not accept that token for this pull request. Check the token and the address.'));
    if (!response.ok) throw new GithubFailure(fail(502, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached. Try again.'));
    return response;
  };
  const detail = await (await get('application/vnd.github+json')).json().catch(() => undefined) as { title?: unknown; user?: { login?: unknown }; head?: { sha?: unknown } } | undefined;
  const title = detail?.title; const author = detail?.user?.login; const headSha = detail?.head?.sha;
  if (typeof title !== 'string' || typeof author !== 'string' || !NAME.test(author) || typeof headSha !== 'string' || !SHA.test(headSha)) throw new GithubFailure(fail(502, 'GITHUB_UNAVAILABLE', 'GitHub returned an unexpected answer. Try again.'));
  const diff = (await (await get('application/vnd.github.diff')).text()).slice(0, DEMO_MAX_DIFF_BYTES);
  return { pullRequest: { owner, repo, pullNumber, headSha, title: title.slice(0, 200), author }, diff };
}

async function modelVerdict(deps: DemoRunDeps, diff: string): Promise<DemoVerdict | undefined> {
  if (deps.review === undefined) return undefined;
  try { return parseVerdict(await deps.review(diff)); } catch (error) { reported(undefined, 'demo.review')(error); return undefined; }
}

export async function handleDemoRun(request: DemoRunRequest, deps: DemoRunDeps): Promise<DemoRunReply> {
  if (request.ip === undefined) return unavailable();
  const key = claimKey(request.ip, deps.pepper);
  try {
    if (await deps.claimed(key)) return used();
    const input = parseInput(request.body);
    if (input === undefined) return invalid('Send a GitHub token and a pull request address together, or neither.');
    let source: DemoRun['source'] = 'sample';
    let material = { pullRequest: SAMPLE_PULL_REQUEST, diff: SAMPLE_DIFF };
    if (input.githubToken !== undefined && input.pullRequest !== undefined) {
      const [, owner, repo, number] = PULL_URL.exec(input.pullRequest) ?? [];
      if (owner === undefined || repo === undefined || number === undefined || /^\.+$/u.test(owner) || /^\.+$/u.test(repo)) return invalid('Use a pull request address like https://github.com/owner/repo/pull/12.');
      source = 'github';
      material = await readGithub(deps, input.githubToken, owner, repo, Number(number));
    }
    if (!await deps.claim(key)) return used();
    const run = runDemo({ id: deps.id(), now: deps.now(), ...material, source, verdict: await modelVerdict(deps, material.diff) });
    count('demo.runs', { source, outcome: run.branch });
    logEvent('demo.run', { source, outcome: run.outcome, branch: run.branch });
    return { status: 200, body: { run } };
  } catch (error) {
    if (error instanceof GithubFailure) return error.reply;
    return unavailable();
  }
}
