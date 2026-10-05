export const LABEL_LIMIT = 120;
const TEMPLATE_LIMIT = 200;
const TOKEN = /\$input\.([A-Za-z0-9_-]+)/gu;

const scalar = (value: unknown): string => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';

export const labelOf = (config: Record<string, unknown>, input: Record<string, unknown>): string | undefined => {
  const template = config['label'];
  if (typeof template !== 'string') return undefined;
  const text = template.replace(TOKEN, (_match, field: string) => scalar(input[field])).replace(/\p{Cc}/gu, ' ').trim().slice(0, LABEL_LIMIT);
  return text || undefined;
};

export const labelTemplateValid = (template: unknown, properties: Record<string, unknown>): boolean => template === undefined || typeof template === 'string' && template.length > 0 && template.length <= TEMPLATE_LIMIT && [...template.matchAll(TOKEN)].every((match) => (match[1] ?? '') in properties);
