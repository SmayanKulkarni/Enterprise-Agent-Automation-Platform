import { expect, test } from 'vitest';
import { buildInstallation, initialChoices, parseFixed, type DiscoveredTool } from './discovery-model.js';

const tools: DiscoveredTool[] = [
  { name: 'create_issue', description: 'Create an issue', risk: 'R3', fields: [{ name: 'owner', type: 'string', required: true }, { name: 'repo', type: 'string', required: true }, { name: 'title', type: 'string', required: true }, { name: 'count', type: 'number', required: false }, { name: 'draft', type: 'boolean', required: false }, { name: 'labels', type: 'array', required: false }] },
  { name: 'ping', risk: 'R3', fields: [] },
];

test('every discovered tool starts included at the most restrictive risk with no fixed arguments', () => {
  expect(initialChoices(tools)).toEqual({ create_issue: { include: true, risk: 'R3', result: 'object', fixed: '' }, ping: { include: true, risk: 'R3', result: 'object', fixed: '' } });
});

test('parses typed fixed arguments from name=value lines and rejects anything else', () => {
  const fields = tools.flatMap((tool) => tool.name === 'create_issue' ? tool.fields : []);
  expect(parseFixed('owner=acme\n repo = widgets \ncount=3\ndraft=true', fields)).toEqual({ owner: 'acme', repo: 'widgets', count: 3, draft: true });
  expect(parseFixed('', fields)).toEqual({});
  for (const bad of ['nope=1', 'owner', 'owner=', 'count=abc', 'draft=maybe', 'labels=x', 'owner=a\nowner=b']) expect(() => parseFixed(bad, fields)).toThrow();
});

test('builds the installation with fixed arguments removed from the input schema and the admin-set risk and result type', () => {
  const choices = { ...initialChoices(tools), create_issue: { include: true, risk: 'R2' as const, result: 'array' as const, fixed: 'owner=acme\nrepo=widgets' }, ping: { include: false, risk: 'R1' as const, result: 'object' as const, fixed: '' } };
  expect(buildInstallation('https://mcp.example/mcp', tools, choices)).toEqual({
    route: 'public', endpoint: 'https://mcp.example/mcp', health: 'healthy',
    manifest: { version: '1', capabilities: [{
      name: 'create_issue', risk: 'R2', fixed: { owner: 'acme', repo: 'widgets' },
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, count: { type: 'number' }, draft: { type: 'boolean' }, labels: { type: 'array' } }, required: ['title'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { result: { type: 'array' } }, required: ['result'], additionalProperties: false },
    }] },
  });
});

test('refuses to certify with nothing included or a fixed argument that does not exist', () => {
  expect(() => buildInstallation('https://mcp.example/mcp', tools, { ...initialChoices(tools), create_issue: { include: false, risk: 'R3', result: 'object', fixed: '' }, ping: { include: false, risk: 'R3', result: 'object', fixed: '' } })).toThrow();
  expect(() => buildInstallation('https://mcp.example/mcp', tools, { ...initialChoices(tools), ping: { include: true, risk: 'R3', result: 'object', fixed: 'x=1' } })).toThrow();
});
