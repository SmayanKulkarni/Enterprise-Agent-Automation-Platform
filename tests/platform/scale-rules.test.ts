import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const QUEUES = ['workitems', 'control-00', 'control-01', 'control-02', 'control-03'];

test('scale rules target the Durable task hub pinned in host.json', () => {
  const host = JSON.parse(readFileSync('host.json', 'utf8')) as { extensions: { durableTask: { hubName: string } } };
  const hub = host.extensions.durableTask.hubName.toLowerCase();
  const rules = readFileSync('infra/scale-rules.jq', 'utf8');
  for (const queue of QUEUES) expect(rules).toContain(`"${hub}-${queue}"`);
});
