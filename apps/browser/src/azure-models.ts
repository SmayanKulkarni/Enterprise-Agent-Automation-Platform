import type { CatalogModel } from './model-catalog.js';

const model = (id: string, name: string, contextLength: number): CatalogModel => ({ id, name, contextLength, structuredOutput: true, tools: true });

export const azureModels: readonly CatalogModel[] = [
  model('gpt-5', 'GPT-5', 400000),
  model('gpt-5-mini', 'GPT-5 mini', 400000),
  model('gpt-5-nano', 'GPT-5 nano', 400000),
  model('gpt-4.1', 'GPT-4.1', 1047576),
  model('gpt-4.1-mini', 'GPT-4.1 mini', 1047576),
  model('gpt-4.1-nano', 'GPT-4.1 nano', 1047576),
  model('gpt-4o', 'GPT-4o', 128000),
  model('gpt-4o-mini', 'GPT-4o mini', 128000),
  model('o4-mini', 'o4-mini', 200000),
  model('o3', 'o3', 200000),
];
