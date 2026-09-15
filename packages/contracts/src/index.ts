export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };
export type TenantId = Brand<string, 'TenantId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type CausationId = Brand<string, 'CausationId'>;
export type EvidenceClassification = 'ordinary' | 'restricted-operational' | 'secret' | 'immutable-audit';
export type NormalizedErrorCategory = 'denied' | 'invalid' | 'conflict' | 'retryable' | 'timeout' | 'unknown-outcome' | 'terminal';
export interface NormalizedError { category: NormalizedErrorCategory; code: string; message: string; redacted?: boolean; retryAfterSeconds?: number; }
export interface ContractEnvelope<Payload extends Record<string, unknown> = Record<string, unknown>> {
  messageId: MessageId; contract: string; contractVersion: string; occurredAt: string; sender: string; payload: Payload;
  tenantId?: TenantId; correlationId?: CorrelationId; causationId?: CausationId; classification: EvidenceClassification;
  integrity?: { algorithm: string; keyId: string; signature: string };
}
export interface ContractDescriptor { classification: EvidenceClassification; name: string; tenantScoped: boolean; version: string; }
export interface CompatibilityDecision { compatible: boolean; reason: 'compatible-major' | 'incompatible-major' | 'invalid-version'; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTRACT_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/u;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const CLASSIFICATIONS = new Set<EvidenceClassification>(['ordinary', 'restricted-operational', 'secret', 'immutable-audit']);
export class ContractValidationError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'ContractValidationError'; } }
function fail(code: string, message: string): never { throw new ContractValidationError(code, message); }
function record(value: unknown): Record<string, unknown> { if (value === null || Array.isArray(value) || typeof value !== 'object') fail('INVALID_OBJECT', 'Expected an object.'); return value as Record<string, unknown>; }
function string(value: unknown, field: string): string { if (typeof value !== 'string' || value.length === 0) fail('INVALID_FIELD', `Invalid ${field}.`); return value; }
function uuid(value: unknown, field: string): string { const result = string(value, field); if (!UUID.test(result)) fail('INVALID_IDENTIFIER', `Invalid ${field}.`); return result.toLowerCase(); }
export function tenantId(value: unknown): TenantId { return uuid(value, 'tenantId') as TenantId; }
export function messageId(value: unknown): MessageId { return uuid(value, 'messageId') as MessageId; }
export function correlationId(value: unknown): CorrelationId { return uuid(value, 'correlationId') as CorrelationId; }
export function causationId(value: unknown): CausationId { return uuid(value, 'causationId') as CausationId; }
function validDate(value: unknown): string { const date = string(value, 'occurredAt'); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(date) || Number.isNaN(Date.parse(date))) fail('INVALID_DATE', 'Invalid occurredAt.'); const canonical = new Date(date).toISOString(); if ((date.includes('.') ? canonical : canonical.replace('.000Z', 'Z')) !== date) fail('INVALID_DATE', 'Invalid occurredAt.'); return date; }
function keys(value: Record<string, unknown>, allowed: readonly string[]): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('UNKNOWN_FIELD', 'Unknown contract field.'); }
export function validateEnvelope<Payload extends Record<string, unknown>>(descriptor: ContractDescriptor, value: unknown): ContractEnvelope<Payload> {
  const envelope = record(value);
  keys(envelope, ['messageId', 'contract', 'contractVersion', 'occurredAt', 'tenantId', 'correlationId', 'causationId', 'sender', 'classification', 'integrity', 'payload']);
  if (string(envelope['contract'], 'contract') !== descriptor.name || !CONTRACT_NAME.test(descriptor.name)) fail('UNKNOWN_CONTRACT', 'Unknown contract.');
  const version = string(envelope['contractVersion'], 'contractVersion'); if (!SEMVER.test(version) || version !== descriptor.version) fail('INCOMPATIBLE_VERSION', 'Unsupported contract version.');
  const classification = envelope['classification'];
  if (!CLASSIFICATIONS.has(classification as EvidenceClassification) || classification !== descriptor.classification) fail('INVALID_CLASSIFICATION', 'Unexpected classification.');
  if (descriptor.tenantScoped && envelope['tenantId'] === undefined) fail('MISSING_TENANT', 'Tenant scope is required.');
  if (envelope['tenantId'] !== undefined) tenantId(envelope['tenantId']); if (envelope['correlationId'] !== undefined) correlationId(envelope['correlationId']); if (envelope['causationId'] !== undefined) causationId(envelope['causationId']);
  if (envelope['integrity'] !== undefined) { const proof = record(envelope['integrity']); keys(proof, ['algorithm', 'keyId', 'signature']); for (const name of ['algorithm', 'keyId', 'signature']) string(proof[name], name); }
  if (envelope['payload'] === undefined) fail('MISSING_PAYLOAD', 'Payload is required.'); const payload = record(envelope['payload']);
  if (payload['error'] !== undefined) validateNormalizedError(payload['error']);
  return { ...(envelope as unknown as ContractEnvelope<Payload>), messageId: messageId(envelope['messageId']), occurredAt: validDate(envelope['occurredAt']), sender: string(envelope['sender'], 'sender') };
}
export function validateNormalizedError(value: unknown): NormalizedError {
  const error = record(value); keys(error, ['category', 'code', 'message', 'redacted', 'retryAfterSeconds']);
  const category = string(error['category'], 'error.category') as NormalizedErrorCategory;
  if (!['denied', 'invalid', 'conflict', 'retryable', 'timeout', 'unknown-outcome', 'terminal'].includes(category)) fail('INVALID_ERROR', 'Invalid error category.');
  const code = string(error['code'], 'error.code'); if (!/^[A-Z][A-Z0-9_]*$/u.test(code)) fail('INVALID_ERROR', 'Invalid error code.');
  string(error['message'], 'error.message');
  if (error['redacted'] !== undefined && typeof error['redacted'] !== 'boolean') fail('INVALID_ERROR', 'Invalid redaction flag.');
  if (error['retryAfterSeconds'] !== undefined && (!Number.isInteger(error['retryAfterSeconds']) || (error['retryAfterSeconds'] as number) < 0)) fail('INVALID_ERROR', 'Invalid retry delay.');
  return error as unknown as NormalizedError;
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value) || Object.is(value, -0)) fail('INVALID_JSON_NUMBER', 'Non-canonical number.'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') { if (Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_JSON_VALUE', 'Only plain JSON objects are allowed.'); const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`; }
  fail('INVALID_JSON_VALUE', 'Value cannot be serialized as JSON.');
}
export async function digest(value: unknown): Promise<string> { const bytes = new TextEncoder().encode(canonicalJson(value)); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
export function assertCompatible(producer: string, consumer: string): CompatibilityDecision { const producerMajor = SEMVER.exec(producer)?.[1]; const consumerMajor = /(?:\^|>=)(\d+)\./u.exec(consumer)?.[1]; if (producerMajor === undefined || consumerMajor === undefined) return { compatible: false, reason: 'invalid-version' }; return producerMajor === consumerMajor ? { compatible: true, reason: 'compatible-major' } : { compatible: false, reason: 'incompatible-major' }; }
export { decodeContract, encodeContract, transformContract } from './codecs.js';
export { CONTRACT_DESCRIPTORS, descriptorFor } from './descriptors.js';
