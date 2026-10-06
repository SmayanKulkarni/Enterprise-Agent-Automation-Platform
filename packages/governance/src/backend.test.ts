import { expect, test } from 'vitest';
import { backendsFromEnvironment } from './backend.js';

const urls = { GOVERNANCE_PROMETHEUS_URL: 'https://p.example/api/prom', GOVERNANCE_LOKI_URL: 'https://l.example', GOVERNANCE_TEMPO_URL: 'https://t.example/tempo', GOVERNANCE_QUERY_TOKEN: 'token' };

test('sends the shared query user to every backend', () => {
  const backends = backendsFromEnvironment({ ...urls, GOVERNANCE_QUERY_USER: 'stack' });
  expect([backends.prometheus.user, backends.loki.user, backends.tempo.user]).toEqual(['stack', 'stack', 'stack']);
});

test('prefers a per-backend user over the shared one', () => {
  const backends = backendsFromEnvironment({ ...urls, GOVERNANCE_QUERY_USER: 'stack', GOVERNANCE_LOKI_USER: 'logs', GOVERNANCE_TEMPO_USER: 'traces' });
  expect([backends.prometheus.user, backends.loki.user, backends.tempo.user]).toEqual(['stack', 'logs', 'traces']);
});

test('sends no credentials when the token or user is missing', () => {
  expect(backendsFromEnvironment({ ...urls, GOVERNANCE_QUERY_TOKEN: '' }).loki).toEqual({ url: 'https://l.example' });
  expect(backendsFromEnvironment(urls).tempo).toEqual({ url: 'https://t.example/tempo' });
});
