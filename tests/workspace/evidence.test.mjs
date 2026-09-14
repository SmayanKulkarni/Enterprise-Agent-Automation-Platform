import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { buildWorkspaceEvidence, publishEvidence } from '../../tools/workspace/evidence.mjs';

/** @type {string[]} */
const fixtureRoots = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function createRoot() {
  const root = mkdtempSync(join(tmpdir(), 'platform-evidence-'));
  fixtureRoots.push(root);
  return root;
}

describe('workspace evidence', () => {
  test('builds deterministic machine-readable results linked to issue 001', () => {
    const evidence = buildWorkspaceEvidence({
      commands: [
        { command: 'pnpm lint', exitCode: 0, name: 'lint' },
        { command: 'pnpm typecheck', exitCode: 0, name: 'typecheck' },
        { command: 'pnpm test', exitCode: 0, name: 'test' },
      ],
      report: {
        configDigests: [{ path: 'package.json', sha256: 'a'.repeat(64) }],
        outputScan: { paths: [], repositoryBounded: true },
        packages: [],
        toolchain: { node: '22.14.0', pnpm: '10.15.1' },
        workspacePatterns: ['apps/*', 'packages/*'],
      },
      toolchain: { node: '22.14.0', pnpm: '10.15.1' },
    });

    expect(evidence).toEqual({
      schemaVersion: 1,
      slices: {
        '001-workspace': {
          commands: [
            { command: 'pnpm lint', exitCode: 0, name: 'lint', status: 'passed' },
            { command: 'pnpm typecheck', exitCode: 0, name: 'typecheck', status: 'passed' },
            { command: 'pnpm test', exitCode: 0, name: 'test', status: 'passed' },
          ],
          configurationDigests: [{ path: 'package.json', sha256: 'a'.repeat(64) }],
          interface: {
            rootCommands: ['lint', 'test', 'typecheck', 'verify', 'workspace:check'],
            workspacePatterns: ['apps/*', 'packages/*'],
          },
          issue: '.scratch/platform-implementation/issues/001-workspace.md',
          outputScan: { paths: [], repositoryBounded: true },
          packageGraph: [],
          sourceSpec: 'docs/superpowers/specs/2026-09-14-01-repository-contract-foundation-spec.md#ordered-implementation-slices',
          toolchain: {
            actual: { node: '22.14.0', pnpm: '10.15.1' },
            digest: '707710c2f268ea012fe92d2cf433f5c40d327778835d311d922459e152e3c4a2',
            requested: { node: '22.14.0', pnpm: '10.15.1' },
          },
        },
      },
    });
  });

  test('preserves the last coherent manifest when new evidence cannot be serialized', () => {
    const root = createRoot();
    const evidenceDirectory = join(root, 'evidence', 'implementation');
    mkdirSync(evidenceDirectory, { recursive: true });
    const manifestPath = join(evidenceDirectory, 'manifest.json');
    writeFileSync(manifestPath, '{"previous":true}\n', 'utf8');

    expect(() => publishEvidence(root, { invalid: 1n })).toThrowError(TypeError);

    expect(readFileSync(manifestPath, 'utf8')).toBe('{"previous":true}\n');
    expect(readdirSync(evidenceDirectory)).toEqual(['manifest.json']);
  });

  test('publishes one complete manifest without staging residue', () => {
    const root = createRoot();

    const manifestPath = publishEvidence(root, { schemaVersion: 1, slices: {} });

    expect(readFileSync(manifestPath, 'utf8')).toBe('{\n  "schemaVersion": 1,\n  "slices": {}\n}\n');
    expect(readdirSync(join(root, 'evidence', 'implementation'))).toEqual(['manifest.json']);
  });
});
