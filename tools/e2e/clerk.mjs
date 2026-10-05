import { createClerkClient } from '@clerk/backend';

const ORIGIN = process.env.E2E_BASE ?? 'http://localhost:5173';
const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const fapi = `https://${Buffer.from(process.env.CLERK_PUBLISHABLE_KEY.split('_').slice(2).join('_'), 'base64').toString().replace(/\$$/u, '')}`;
const sessions = new Map();

const form = (values) => new URLSearchParams(values).toString();
const call = async (path, init = {}) => {
  const response = await fetch(`${fapi}${path}`, { ...init, headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(`clerk ${path} -> ${response.status} ${JSON.stringify(body.errors?.[0]?.message ?? body)}`);
  return { body, cookie: response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ') };
};

async function open(userId) {
  const dev = (await call('/v1/dev_browser', { method: 'POST' })).body;
  const ticket = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 600 });
  const signIn = await call(`/v1/client/sign_ins?__clerk_db_jwt=${dev.id}`, { method: 'POST', body: form({ strategy: 'ticket', ticket: ticket.token }) });
  const sessionId = signIn.body.response.created_session_id;
  return { dev: dev.id, sessionId, cookie: signIn.cookie };
}

export async function tokenFor(userId) {
  let session = sessions.get(userId);
  if (!session) { session = await open(userId); sessions.set(userId, session); }
  const { body } = await call(`/v1/client/sessions/${session.sessionId}/tokens?__clerk_db_jwt=${session.dev}`, { method: 'POST', headers: { cookie: session.cookie } });
  return body.jwt;
}

export const users = { workflowAdmin: 'user_3Js4rlAGm83zW3CMsf92WUbqKjd', governanceAdmin: 'user_3K56LqccdysMqKkC8ueToBQCIrz' };
