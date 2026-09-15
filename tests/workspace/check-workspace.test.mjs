import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { validateWorkspace, WorkspaceValidationError } from '../../tools/workspace/check-workspace.mjs';

/** @type {string[]} */
const fixtureRoots = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {unknown} value
 */
function writeJson(root, relativePath, value) {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createValidWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'platform-workspace-'));
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

/**
 * @param {string} root
 * @param {string} code
 */
function expectValidationCode(root, code) {
  expect(() => validateWorkspace(root)).toThrowError(
    expect.objectContaining({ code, name: WorkspaceValidationError.name }),
  );
}

describe('validateWorkspace', () => {
  test('reports the intended empty package graph', () => {
    const root = createValidWorkspace();

    const report = validateWorkspace(root);

    expect(report.packages).toEqual([]);
    expect(report.workspacePatterns).toEqual(['apps/*', 'packages/*']);
    expect(report.outputScan).toEqual({ paths: [], repositoryBounded: true });
  });

  test('rejects workspace patterns that can include packages outside the repository', () => {
    const root = createValidWorkspace();
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - ../outside/*\n', 'utf8');

    expectValidationCode(root, 'INVALID_WORKSPACE_MEMBERSHIP');
  });

  test('rejects a relaxed strict compiler option', () => {
    const root = createValidWorkspace();
    writeJson(root, 'tsconfig.base.json', {
      compilerOptions: { strict: false },
    });

    expectValidationCode(root, 'RELAXED_COMPILER_SETTINGS');
  });

  test('rejects cycles between workspace packages', () => {
    const root = createValidWorkspace();
    writeJson(root, 'packages/alpha/package.json', {
      name: '@platform/alpha',
      dependencies: { '@platform/beta': 'workspace:*' },
    });
    writeJson(root, 'packages/beta/package.json', {
      name: '@platform/beta',
      dependencies: { '@platform/alpha': 'workspace:*' },
    });

    expectValidationCode(root, 'DEPENDENCY_CYCLE');
  });

  test('rejects compiler output configured outside the repository', () => {
    const root = createValidWorkspace();
    writeJson(root, 'tsconfig.json', {
      extends: './tsconfig.base.json',
      compilerOptions: { outDir: '../outside' },
    });

    expectValidationCode(root, 'OUT_OF_SCOPE_BUILD_OUTPUT');
  });
});
