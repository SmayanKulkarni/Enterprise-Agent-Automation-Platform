import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { EnvironmentDrawer, sectionFromHash, sectionIds, type DrawerSection } from './environment-drawer.js';

const sections = (renders: Record<string, () => string>): DrawerSection[] => sectionIds.map((id) => ({ id, label: id.toUpperCase(), hint: `${id} hint`, render: renders[id] ?? (() => id) }));

describe('environment drawer', () => {
  test('maps every legacy panel anchor and run link to a section', () => {
    expect(sectionFromHash('#provider-panel')).toBe('provider');
    expect(sectionFromHash('#connector-panel')).toBe('connectors');
    expect(sectionFromHash('#webhook-panel')).toBe('webhook');
    expect(sectionFromHash('#memory-panel')).toBe('memory');
    expect(sectionFromHash('#run-1234')).toBe('runs');
    expect(sectionFromHash('#runs-panel')).toBe('runs');
    expect(sectionFromHash('#unrelated')).toBeUndefined();
    expect(sectionFromHash('')).toBeUndefined();
  });

  test('mounts only the selected section', () => {
    const renders = Object.fromEntries(sectionIds.map((id) => [id, vi.fn(() => `content-${id}`)]));
    const html = renderToStaticMarkup(<EnvironmentDrawer open section="webhook" sections={sections(renders)} onSelect={() => undefined} onClose={() => undefined} />);
    expect(html).toContain('content-webhook');
    for (const id of sectionIds.filter((item) => item !== 'webhook')) { expect(html).not.toContain(`content-${id}`); expect(renders[id]).not.toHaveBeenCalled(); }
    expect(renders['webhook']).toHaveBeenCalledTimes(1);
    expect(html.match(/aria-current="page"/gu)).toHaveLength(1);
  });

  test('renders nothing while closed and never mounts a section', () => {
    const render = vi.fn(() => 'x');
    expect(renderToStaticMarkup(<EnvironmentDrawer open={false} section="models" sections={sections({ models: render })} onSelect={() => undefined} onClose={() => undefined} />)).toBe('');
    expect(render).not.toHaveBeenCalled();
  });

  test('falls back to the first section when the requested one is unavailable', () => {
    const html = renderToStaticMarkup(<EnvironmentDrawer open section="runs" sections={sections({ provider: () => 'first' }).slice(0, 2)} onSelect={() => undefined} onClose={() => undefined} />);
    expect(html).toContain('first');
  });
});
