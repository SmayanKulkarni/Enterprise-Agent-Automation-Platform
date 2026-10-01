import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { CreateGroup } from './create-group.js';

const tenants = [{ id: 'a1000000-0000-4000-8000-000000000001', profiles: ['admin'], epoch: 1 }, { id: 'b2000000-0000-4000-8000-000000000002', profiles: ['operator'], epoch: 1 }];
const render = () => renderToStaticMarkup(<CreateGroup tenants={tenants} create={() => undefined} busy={false} notice={undefined} />);

describe('CreateGroup', () => {
  test('offers only workspaces the user administers', () => {
    const html = render();
    expect(html).toContain('a1000000');
    expect(html).not.toContain('b2000000');
  });

  test('disables submit until a name and a workspace are chosen', () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>Create group<\/button>/u);
  });
});
