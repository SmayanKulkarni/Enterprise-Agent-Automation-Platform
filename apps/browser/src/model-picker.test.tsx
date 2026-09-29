import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { azureModels } from './azure-models.js';
import { describeModel, filterModels, modelProblem, parseCatalogModels, type CatalogModel } from './model-catalog.js';
import { ModelPicker } from './model-picker.js';

const model = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({ id, structuredOutput: true, tools: true, ...extra });
const catalog = [model('anthropic/claude-sonnet-5.5', { name: 'Claude Sonnet 5.5', contextLength: 500000, promptPrice: 0.000003, completionPrice: 0.000015 }), model('openai/gpt-5', { name: 'GPT-5' }), model('openai/gpt-5-mini', { tools: false }), model('meta/llama', { structuredOutput: false })];

describe('model picker', () => {
  test('a prefilled value does not narrow the list until the user types', () => {
    expect(filterModels(catalog, undefined).map((item) => item.id)).toEqual(catalog.map((item) => item.id));
    expect(filterModels(catalog, '').length).toBe(catalog.length);
  });

  test('typing filters by id and name tokens and ranks an exact or prefix match first', () => {
    expect(filterModels(catalog, 'sonnet').map((item) => item.id)).toEqual(['anthropic/claude-sonnet-5.5']);
    expect(filterModels(catalog, 'gpt 5').map((item) => item.id)).toEqual(['openai/gpt-5', 'openai/gpt-5-mini']);
    expect(filterModels(catalog, 'openai/gpt-5-mini')[0]?.id).toBe('openai/gpt-5-mini');
    expect(filterModels([model('a/x-gpt'), model('gpt-4')], 'gpt').map((item) => item.id)).toEqual(['gpt-4', 'a/x-gpt']);
    expect(filterModels(catalog, 'nothing-matches')).toEqual([]);
  });

  test('flags a model missing a required capability but allows unknown slugs offline', () => {
    const tooling = catalog.find((item) => item.id === 'openai/gpt-5-mini');
    expect(modelProblem(tooling, 'openai/gpt-5-mini', catalog.length, true, true, 'OpenRouter')).toMatch(/tool calling/);
    expect(modelProblem(catalog[3], 'meta/llama', catalog.length, true, false, 'OpenRouter')).toMatch(/structured output/);
    expect(modelProblem(undefined, 'custom/slug', catalog.length, true, false, 'OpenRouter')).toBe('Not in the OpenRouter catalog.');
    expect(modelProblem(undefined, 'custom/slug', 0, true, true, 'OpenRouter')).toBeUndefined();
    expect(modelProblem(catalog[1], 'openai/gpt-5', catalog.length, true, true, 'OpenRouter')).toBeUndefined();
  });

  test('parses catalog projections defensively and describes price and context', () => {
    const parsed = parseCatalogModels([{ id: 'a/b', structuredOutput: true, tools: true, contextLength: 1000, promptPrice: 0.000001, completionPrice: 0.000002 }, { id: 'c/d', structuredOutput: false }, { id: 5 }, null]);
    expect(parsed.map((item) => [item.id, item.tools])).toEqual([['a/b', true], ['c/d', false]]);
    expect(describeModel(parsed[0])).toBe('1,000 token context · $1.00 in / $2.00 out per 1M tokens · structured output · tool calling');
    expect(parseCatalogModels('nope')).toEqual([]);
  });

  test('the closed picker shows the prefilled value in an accessible combobox without mounting the list', () => {
    const html = renderToStaticMarkup(<ModelPicker label="Exact model" value="openai/gpt-5" models={catalog} onChange={() => undefined} />);
    expect(html).toContain('role="combobox"'); expect(html).toContain('value="openai/gpt-5"'); expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('role="listbox"');
  });

  test('Azure ships a curated list of tool-capable base models', () => {
    expect(azureModels.length).toBeGreaterThan(5);
    expect(azureModels.every((item) => item.tools && item.structuredOutput)).toBe(true);
    expect(new Set(azureModels.map((item) => item.id)).size).toBe(azureModels.length);
  });
});
