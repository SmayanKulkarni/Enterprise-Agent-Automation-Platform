import { randomUUID, createHash } from 'node:crypto';
import { tokenFor, users } from './clerk.mjs';

export const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
export const TENANT = '11111111-1111-4111-8111-111111111111';
const mediaType = 'application/vnd.platform.browser.v1+json';

const canonical = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

export class Client {
  constructor(userId, label) { this.userId = userId; this.label = label; }
  async headers(extra = {}) { return { accept: mediaType, origin: BASE, authorization: `Bearer ${await tokenFor(this.userId)}`, 'x-correlation-id': randomUUID(), ...extra }; }
  async get(path, tenant = TENANT) {
    const response = await fetch(`${BASE}/api/v1${path}`, { headers: await this.headers(tenant ? { 'x-platform-tenant': tenant } : {}) });
    return unwrap(response, `GET ${path}`);
  }
  projection(collection, id) { return this.get(`/tenants/${TENANT}/${collection}${id ? `/${id}` : ''}`).then((body) => body.records ?? body); }
  async command(owner, name, args, { expectedVersion = 0, key = randomUUID() } = {}) {
    const correlationId = randomUUID();
    const payload = { messageId: correlationId, contract: 'browser.v1', contractVersion: '1.0.0', occurredAt: new Date().toISOString(), tenantId: TENANT, correlationId, sender: 'platform-browser', classification: 'restricted-operational', payload: { expectedVersion, arguments: args } };
    const response = await fetch(`${BASE}/api/v1/tenants/${TENANT}/commands/${owner}/${name}`, { method: 'POST', headers: await this.headers({ 'content-type': mediaType, 'x-platform-tenant': TENANT, 'if-match': String(expectedVersion), 'idempotency-key': key }), body: JSON.stringify(payload) });
    return unwrap(response, `${owner}.${name}`);
  }
  async post(path, body) {
    const response = await fetch(`${BASE}/api/v1${path}`, { method: 'POST', headers: await this.headers({ 'content-type': 'application/json', 'x-platform-tenant': TENANT, 'idempotency-key': randomUUID() }), body: JSON.stringify(body) });
    return unwrap(response, `POST ${path}`);
  }
}

async function unwrap(response, label) {
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${label} -> ${response.status} ${JSON.stringify(body?.error ?? body ?? {}).slice(0, 300)}`);
  return body?.payload ?? body;
}

export const workflowAdmin = new Client(users.workflowAdmin, 'workflow-admin');
export const governanceAdmin = new Client(users.governanceAdmin, 'governance-admin');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export { randomUUID };
