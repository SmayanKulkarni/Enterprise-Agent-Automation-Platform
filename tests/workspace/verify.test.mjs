import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { VerificationError, verifyWorkspace } from '../../tools/workspace/verify.mjs';

/** @type {string[]} */
const fixtureRoots = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

/** @param {string} root @param {string} relativePath @param {unknown} value */
function writeJson(root, relativePath, value) {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'platform-verify-'));
  fixtureRoots.push(root);
  writeJson(root, 'package.json', {
    name: 'fixture-workspace',
    private: true,
    packageManager: 'pnpm@10.15.1',
    engines: { node: '22.14.0', pnpm: '10.15.1' },
    scripts: {
      lint: 'eslint .',
      typecheck: 'tsc -p tsconfig.json',
      test: 'vitest run',
      contracts: 'tsc -p packages/contracts/tsconfig.build.json && node tools/contracts/governance.mjs',
      'workspace:check': 'node tools/workspace/check-workspace.mjs',
      verify: 'node tools/workspace/verify.mjs',
    },
  });
  writeFileSync(join(root, '.node-version'), '22.14.0\n', 'utf8');
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n', 'utf8');
  writeJson(root, 'tsconfig.base.json', {
    compilerOptions: {
      allowUnreachableCode: false,
      allowUnusedLabels: false,
      exactOptionalPropertyTypes: true,
      forceConsistentCasingInFileNames: true,
      noEmit: true,
      noFallthroughCasesInSwitch: true,
      noImplicitAny: true,
      noImplicitOverride: true,
      noImplicitReturns: true,
      noPropertyAccessFromIndexSignature: true,
      noUncheckedIndexedAccess: true,
      strict: true,
      strictNullChecks: true,
      useUnknownInCatchVariables: true,
    },
  });
  writeJson(root, 'tsconfig.json', { extends: './tsconfig.base.json' });
  return root;
}

describe('verifyWorkspace', () => {
  test('publishes command results only after every root command passes', () => {
    const root = createWorkspace();

    const result = verifyWorkspace(root, {
      getActualToolchain: () => ({ node: '22.14.0', pnpm: '10.15.1' }),
      runCommand: ({ command, name }) => ({ command, exitCode: 0, name }),
    });

    expect(result.commands.map(({ name }) => name)).toEqual([
      'workspace:check',
      'contracts',
      'lint',
      'typecheck',
      'test',
    ]);
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
    expect(manifest.slices['001-workspace'].commands).toEqual(
      result.commands.map((command) => ({ ...command, status: 'passed' })),
    );
  });

  test('retains prior evidence when a root command fails', () => {
    const root = createWorkspace();
    const manifestPath = join(root, 'evidence', 'implementation', 'manifest.json');
    mkdirSync(join(root, 'evidence', 'implementation'), { recursive: true });
    writeFileSync(manifestPath, '{"previous":true}\n', 'utf8');

    expect(() =>
      verifyWorkspace(root, {
        getActualToolchain: () => ({ node: '22.14.0', pnpm: '10.15.1' }),
        runCommand: ({ command, name }) => ({ command, exitCode: name === 'typecheck' ? 1 : 0, name }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'ROOT_COMMAND_FAILED', name: VerificationError.name }));

    expect(readFileSync(manifestPath, 'utf8')).toBe('{"previous":true}\n');
    expect(readdirSync(join(root, 'evidence', 'implementation'))).toEqual(['manifest.json']);
  });

  test('fails closed when the executing toolchain differs from the pins', () => {
    const root = createWorkspace();

    expect(() =>
      verifyWorkspace(root, {
        getActualToolchain: () => ({ node: '22.14.1', pnpm: '10.15.1' }),
        runCommand: ({ command, name }) => ({ command, exitCode: 0, name }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'TOOLCHAIN_MISMATCH', name: VerificationError.name }));

    expect(existsSync(join(root, 'evidence'))).toBe(false);
  });
});
