import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateValue, type JsonSchema } from './graph.js';

export const WEBHOOK_BODY_LIMIT = 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SIGNATURE = /^sha256=[a-f0-9]{64}$/iu;
const EVENT = /^[a-z_]{1,40}$/u;
export const MAP_SOURCE = /^\$(?:event|body(?:\.[A-Za-z0-9_]+)+)$/u;

export interface GithubDelivery { eventId: string; event: string; signature: string; }
type Headers = Readonly<Record<string, string | undefined>>;

export const githubDelivery = (headers: Headers): GithubDelivery | undefined => {
  const eventId = headers['x-github-delivery']; const event = headers['x-github-event']; const signature = headers['x-hub-signature-256'];
  return eventId !== undefined && uuid.test(eventId) && event !== undefined && EVENT.test(event) && signature !== undefined && SIGNATURE.test(signature) ? { eventId, event, signature } : undefined;
};

export const verifyGithubSignature = (secrets: readonly string[], body: Uint8Array, signature: string): boolean => {
  const received = Buffer.from(signature.slice(7), 'hex');
  return secrets.some((secret) => timingSafeEqual(createHmac('sha256', secret).update(body).digest(), received));
};

const read = (source: unknown, path: readonly string[]): unknown => path.reduce<unknown>((value, key) => value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined, source);

const wanted = (value: unknown, allowed: unknown): boolean => !Array.isArray(allowed) || allowed.includes(value);

export type Mapped = { kind: 'input'; input: Record<string, unknown> } | { kind: 'ignored' } | { kind: 'invalid' };

export function mapDelivery(config: Record<string, unknown>, payload: unknown, event: string): Mapped {
  const when = config['when'] !== null && typeof config['when'] === 'object' ? config['when'] as Record<string, unknown> : {};
  const action = read(payload, ['action']);
  if (!wanted(event, when['event']) || Array.isArray(when['action']) && !when['action'].includes(action) || event === 'push' && read(payload, ['deleted']) === true) return { kind: 'ignored' };
  const map = config['inputMap'] as Record<string, string>;
  const input: Record<string, unknown> = {};
  for (const [field, source] of Object.entries(map)) {
    const value: unknown = source === '$event' ? event : read(payload, source.split('.').slice(1));
    if (value !== undefined) input[field] = value;
  }
  return validateValue(input, config['inputSchema'] as JsonSchema) ? { kind: 'input', input } : { kind: 'invalid' };
}

export const githubConfigValid = (config: Record<string, unknown>): boolean => {
  const { source, inputMap, when } = config;
  if (source === undefined) return inputMap === undefined && when === undefined;
  if (source !== 'github' || config['mode'] !== 'webhook' || inputMap === null || typeof inputMap !== 'object' || Array.isArray(inputMap)) return false;
  const { properties, required } = config['inputSchema'] as JsonSchema;
  const entries = Object.entries(inputMap);
  if (!entries.every(([field, path]) => field in properties && typeof path === 'string' && MAP_SOURCE.test(path)) || !required.every((field) => field in inputMap)) return false;
  if (when === undefined) return true;
  if (when === null || typeof when !== 'object' || Array.isArray(when) || Object.keys(when).some((key) => key !== 'event' && key !== 'action')) return false;
  return Object.values(when as Record<string, unknown>).every((list) => Array.isArray(list) && list.length >= 1 && list.length <= 20 && list.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 64));
};
