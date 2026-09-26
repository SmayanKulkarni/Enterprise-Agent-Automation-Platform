import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export interface OpenRouterConnection { provider: 'openrouter'; enabled: boolean; key?: { version: string; iv: string; tag: string; ciphertext: string }; digest?: string; verifiedAt?: string; }

const key = (value: string): Buffer => {
  const parsed = Buffer.from(value, 'base64url');
  if (parsed.length !== 32) throw new Error('OPENROUTER_CONNECTION_UNAVAILABLE');
  return parsed;
};

export class OpenRouterConnectionCrypto {
  constructor(private readonly version: string, private readonly wrappingKey: Buffer) {}
  static fromEnvironment(environment: Readonly<Record<string, string | undefined>>): OpenRouterConnectionCrypto {
    const version = environment['WORKFLOW_OPENROUTER_WRAPPING_KEY_VERSION']?.trim();
    const value = environment['WORKFLOW_OPENROUTER_WRAPPING_KEY']?.trim();
    if (!version || !value) throw new Error('OPENROUTER_CONNECTION_UNAVAILABLE');
    return new OpenRouterConnectionCrypto(version, key(value));
  }
  seal(tenantId: string, secret: string): NonNullable<OpenRouterConnection['key']> {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.wrappingKey, iv); cipher.setAAD(Buffer.from(`${tenantId}:openrouter:${this.version}`));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return { version: this.version, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
  }
  open(tenantId: string, envelope: NonNullable<OpenRouterConnection['key']>): string {
    if (envelope.version !== this.version) throw new Error('OPENROUTER_CONNECTION_UNAVAILABLE');
    const decipher = createDecipheriv('aes-256-gcm', this.wrappingKey, Buffer.from(envelope.iv, 'base64url')); decipher.setAAD(Buffer.from(`${tenantId}:openrouter:${envelope.version}`)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }
  digest(tenantId: string, secret: string): string { return createHmac('sha256', this.wrappingKey).update(`${tenantId}:openrouter:${secret}`).digest('hex'); }
}
