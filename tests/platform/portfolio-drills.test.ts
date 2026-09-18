import { describe, expect, test } from 'vitest';

import { PortfolioDrillHarness, type DemoEvidence, type DemoRunManifest, type RubricClaim, PORTFOLIO_JOURNEYS } from '../../packages/portfolio/src/index.js';

const now = '2099-01-01T00:00:00.000Z';
const before = '2098-12-31T23:00:00.000Z';
const harness = () => new PortfolioDrillHarness(() => false, () => now);

async function run(): Promise<{ harness: PortfolioDrillHarness; manifest: DemoRunManifest }> {
  const local = harness(); const evidence = await Promise.all(PORTFOLIO_JOURNEYS.map((journey, index) => local.evidence({ id: `evidence-${journey}`, path: `fixture/${journey}.json`, classification: index === 0 ? 'simulated-failure' : 'fixture', producer: 'portfolio-drill', recordedAt: before, correlationId: `run-${String(index)}`, payload: { journey, disposition: 'reconciled' } })));
  const manifest = await local.publish({ schemaVersion: '1.0.0', id: 'second-operator-1', operator: 'operator-2', startedAt: before, endedAt: now, packageDigests: ['a'.repeat(64), 'b'.repeat(64)], environment: { provider: 'fixture', version: 'v1' }, evidence, steps: PORTFOLIO_JOURNEYS.map((journey, index) => ({ journey, command: `run.${journey}`, prerequisites: [], ...(index === 0 ? { injection: 'migration-crash' as const } : {}), expected: 'reconciled', ownerAction: 'runbook://portfolio/v1', timeoutSeconds: 60, evidenceIds: [`evidence-${journey}`], outcome: 'passed' as const })) });
  return { harness: local, manifest };
}

describe('portfolio drill harness', () => {
  test('publishes immutable fixture evidence and scores a complete second-operator run', async () => {
    const { harness: local, manifest } = await run(); const claims: RubricClaim[] = (['product', 'engineering', 'operational'] as const).flatMap((pillar) => Array.from({ length: 12 }, (_, index) => ({ pillar, id: `${pillar}-${String(index)}`, evidenceIds: [manifest.evidence[index % manifest.evidence.length]?.id ?? ''], passed: true })));
    await expect(local.score(manifest, claims)).resolves.toMatchObject({ complete: true, total: 36, pillars: { product: 12, engineering: 12, operational: 12 } });
    await expect(local.publish({ ...manifest, digest: undefined } as unknown as Omit<DemoRunManifest, 'digest'>)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('fails closed for tampering, secrets, forged live labels and incomplete scoring', async () => {
    const { harness: local, manifest } = await run(); const first = manifest.evidence[0] as DemoEvidence;
    await expect(local.publish({ ...manifest, id: 'tampered', digest: undefined, evidence: [{ ...first, digest: '0'.repeat(64) }, ...manifest.evidence.slice(1)] } as unknown as Omit<DemoRunManifest, 'digest'>)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(local.evidence({ ...first, id: 'secret', payload: { token: 'never' } })).rejects.toMatchObject({ code: 'INVALID' });
    const live = await local.evidence({ ...first, classification: 'live' });
    await expect(local.publish({ ...manifest, id: 'forged-live', digest: undefined, evidence: [live, ...manifest.evidence.slice(1)] } as unknown as Omit<DemoRunManifest, 'digest'>)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(local.score({ ...manifest, evidence: [...manifest.evidence, first] }, [])).rejects.toMatchObject({ code: 'DENIED' });
    const claims: RubricClaim[] = Array.from({ length: 36 }, (_, index) => ({ pillar: index < 12 ? 'product' : index < 24 ? 'engineering' : 'operational', id: `claim-${String(index)}`, evidenceIds: [first.id], passed: index !== 0, critical: index === 0 }));
    await expect(local.score(manifest, claims)).resolves.toMatchObject({ complete: false, total: 35 });
  });
});
