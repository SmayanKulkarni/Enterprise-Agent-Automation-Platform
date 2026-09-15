import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT_COMMANDS = ['contracts', 'lint', 'test', 'typecheck', 'verify', 'workspace:check'];

/**
 * @typedef {{ command: string, exitCode: number, name: string }} CommandResult
 * @typedef {{ node: string, pnpm: string }} Toolchain
 * @typedef {{
 *   configDigests: Array<{path: string, sha256: string}>,
 *   outputScan: {paths: string[], repositoryBounded: boolean},
 *   packages: Array<{name: string, path: string}>,
 *   toolchain: Toolchain,
 *   workspacePatterns: string[]
 * }} WorkspaceReport
 */

/**
 * @param {{ commands: CommandResult[], report: WorkspaceReport, toolchain: Toolchain }} input
 */
export function buildWorkspaceEvidence({ commands, report, toolchain }) {
  return {
    schemaVersion: 1,
    slices: {
      '001-workspace': {
        commands: commands.map((result) => ({
          ...result,
          status: result.exitCode === 0 ? 'passed' : 'failed',
        })),
        configurationDigests: report.configDigests,
        interface: {
          rootCommands: ROOT_COMMANDS,
          workspacePatterns: report.workspacePatterns,
        },
        issue: '.scratch/platform-implementation/issues/001-workspace.md',
        outputScan: report.outputScan,
        packageGraph: report.packages,
        sourceSpec:
          'docs/superpowers/specs/2026-09-14-01-repository-contract-foundation-spec.md#ordered-implementation-slices',
        toolchain: {
          actual: toolchain,
          digest: createHash('sha256')
            .update(`node=${report.toolchain.node}\npnpm=${report.toolchain.pnpm}\n`)
            .digest('hex'),
          requested: report.toolchain,
        },
      },
      '004a-browser-transport': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'browser.v1 fixed route inventory, strict packed decoding, named command registry, normalized FEATURE_NOT_READY responses',
        issue: '.scratch/platform-implementation/issues/004a-browser-transport.md',
      },
      '011-durable-execution': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'InMemoryCaseWorkflow durable history, timer fence, recorded activity replay',
        issue: '.scratch/platform-implementation/issues/011-durable-execution.md',
      },
      '012-intervention': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'InterventionRuntime typed request, current fence and first-valid/quorum joins',
        issue: '.scratch/platform-implementation/issues/012-intervention.md',
      },
      '013-agent-team': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'AgentTeamRuntime declared-role assignments, joins and budget reservation',
        issue: '.scratch/platform-implementation/issues/013-agent-team.md',
      },
      '014-recovery': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'RecoveryRuntime pause/resume scheduling fence and explicit dispositions',
        issue: '.scratch/platform-implementation/issues/014-recovery.md',
      },
      '015-intent-idempotency': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'EffectIntentRuntime canonical payload digest, approval fence and duplicate receipt',
        issue: '.scratch/platform-implementation/issues/015-intent-idempotency.md',
      },
      '009a-clerk-browser-session': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'ClerkSessionAdapter current-session proof, safe session/Tenant DTOs and scoped Case workbench state',
        issue: '.scratch/platform-implementation/issues/009a-clerk-browser-session.md',
      },
      '016-invocation-admission': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'CapabilityGateway normalized invocation, closed schemas and pre-dispatch Tenant/authority/budget/admission fences',
        issue: '.scratch/platform-implementation/issues/016-invocation-admission.md',
      },
      '017-attempt-receipt-reconcile': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Durable in-memory attempt/receipt records and explicit unknown-outcome reconciliation checkpoints',
        issue: '.scratch/platform-implementation/issues/017-attempt-receipt-reconcile.md',
      },
      '018-flow-control': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Bounded concurrency/queue/throughput admission with conservative shared unknown-quota bucket',
        issue: '.scratch/platform-implementation/issues/018-flow-control.md',
      },
      '018a-case-workbench': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'BrowserV1 Tenant-scoped projection route and CaseWorkbench watermark/event-gap refresh state',
        issue: '.scratch/platform-implementation/issues/018a-case-workbench.md',
      },
      '019-definitions-releases': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Immutable capability definitions and locally signed adapter releases',
        issue: '.scratch/platform-implementation/issues/019-definitions-releases.md',
      },
      '020-installations': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Tenant installation transitions, ordered authenticated callbacks and Tenant-filtered availability discovery',
        issue: '.scratch/platform-implementation/issues/020-installations.md',
      },
    },
  };
}

/**
 * Publish the complete evidence document with a same-directory atomic rename.
 * Serialization happens before any filesystem mutation, so invalid evidence
 * cannot disturb the last coherent manifest.
 *
 * @param {string} rootDirectory
 * @param {unknown} evidence
 */
export function publishEvidence(rootDirectory, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidenceDirectory = resolve(rootDirectory, 'evidence', 'implementation');
  const manifestPath = resolve(evidenceDirectory, 'manifest.json');
  const stagingPath = resolve(evidenceDirectory, `.manifest-${process.pid}.tmp`);
  mkdirSync(evidenceDirectory, { recursive: true });

  try {
    writeFileSync(stagingPath, serialized, { encoding: 'utf8', flag: 'wx' });
    renameSync(stagingPath, manifestPath);
  } catch (error) {
    rmSync(stagingPath, { force: true });
    throw error;
  }

  return manifestPath;
}
