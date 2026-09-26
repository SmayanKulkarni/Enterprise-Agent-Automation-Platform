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
        outputScan: report.outputScan,
        packageGraph: report.packages,
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
      },
      '011-durable-execution': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'InMemoryCaseWorkflow durable history, timer fence, recorded activity replay',
      },
      '012-intervention': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'InterventionRuntime typed request, current fence and first-valid/quorum joins',
      },
      '013-agent-team': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'AgentTeamRuntime declared-role assignments, joins and budget reservation',
      },
      '014-recovery': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'RecoveryRuntime pause/resume scheduling fence and explicit dispositions',
      },
      '015-intent-idempotency': {
        checks: ['tests/platform/runtime-browser.test.ts'],
        interface: 'EffectIntentRuntime canonical payload digest, approval fence and duplicate receipt',
      },
      '009a-clerk-browser-session': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'ClerkSessionAdapter current-session proof, safe session/Tenant DTOs and scoped Case workbench state',
      },
      '009b-live-clerk-integration': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Official Clerk Backend SDK session-token verification, active-session recheck and browser bearer-header helper',
      },
      '016-invocation-admission': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'CapabilityGateway normalized invocation, closed schemas and pre-dispatch Tenant/authority/budget/admission fences',
      },
      '017-attempt-receipt-reconcile': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Durable in-memory attempt/receipt records and explicit unknown-outcome reconciliation checkpoints',
      },
      '018-flow-control': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Bounded concurrency/queue/throughput admission with conservative shared unknown-quota bucket',
      },
      '018a-case-workbench': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'BrowserV1 Tenant-scoped projection route and CaseWorkbench watermark/event-gap refresh state',
      },
      '019-definitions-releases': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Immutable capability definitions and locally signed adapter releases',
      },
      '020-installations': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Tenant installation transitions, ordered authenticated callbacks and Tenant-filtered availability discovery',
      },
      '021-credentials': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Reference-only fake secret store, scoped invocation-local acquisition, probe-then-switch rotation, epoch cache invalidation and revocation receipts',
      },
      '022-extension-isolation': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Disposable local ExtensionRunner with default-deny network/resource policy, immutable invocation input and output DLP/size gate',
      },
      '023-lifecycle-integration': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Epoch-bound provider readiness, atomic checked release upgrade, callback fence and reconciled removal',
      },
      '024-provenance-graph': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Immutable Tenant-scoped provenance records, parent validation, acyclic lineage and immediate eligibility epochs',
      },
      '025-scoped-stores': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Authority, consent, policy, retention and explicit-scope governed in-memory/relational write-read adapters',
      },
      '026-retrieval': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Eligibility-before-ranking query, provenance projections, graph-epoch cache key, bounded result budgets and non-widening unavailable-adapter fallback',
      },
      '039-change-lifecycle': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'SolutionLifecycle compatible activation change, immutable migration checkpoint, rollback disposition, quarantine and hold/retire fences',
      },
      '039a-studio-catalog-view': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'browser.v1 Tenant-scoped packages/installations projection routes and owner-command boundary',
      },
      '040-operations-intake': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'OperationsRuntime packed operations.event decode, correlation/causation-preserving safe transform, idempotent dedupe and non-leaking quarantine',
      },
      '041-operations-projection': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Deterministic Tenant projection with source versions, watermark, gap completeness and Tenant-bound cursor',
      },
      '041a-mongo-operations-read-model': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Disposable Mongo-shaped safe snapshot read model with exact Tenant partition purge and rebuild equivalence',
      },
      '042-signals-cost': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Append-only audit evidence, bounded safe projections and explicit estimated/final/unknown/shared rate-versioned cost states',
      },
      '043-operations-commands': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Fresh-authority exact-digest owner command transport with stored retry receipt and separate projection catch-up state',
      },
      '043a-operations-browser': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Safe OperationsWorkbench projection and approval/manifest-fenced owner command intent',
      },
      '044-operations-experience': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Tenant-scoped operational evidence/cost projection plus versioned runbook alert fire/group/clear state',
      },
      '045-technical-implementation-package': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Signed fixture-only Technical Implementation package carrying exact SQL/Blob/Boards capabilities through shared activation',
      },
      '046-deterministic-tools': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Version-fenced public bootstrap, seed and readiness commands with two-Tenant fixture inventory and digests',
      },
      '047-technical-implementation-success': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Fixture-only Technical Implementation Case with information intervention, exact package pin, SQL/Blob/Boards receipts and evaluation evidence',
      },
      '048-technical-implementation-negatives-recovery': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Labeled local denial, stale approval, throttle, conflict, reconciliation and replay recovery manifest',
      },
      '049-reset-repeat': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Paired deterministic run digests plus exact reset/resume, held-evidence and foreign-object residual reports',
      },
      '049a-technical-browser-journey': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Registered browser.v1 Case run/reset commands requiring current Tenant proof and exact seeded fixture version',
      },
      '050-policy-iac-shell': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Bicep policy-tag shell and fail-closed environment plan allowlist for region, SKU, tags, lease, scope, cost and destructive target',
      },
      '051-foundations-data': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Private-ingress, least-privilege foundation inventory with reference-only configuration, backup coverage and Tenant-scoped quarantine restore',
      },
      '052-compute-telemetry': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Managed-identity internal compute port with no ambient network handles, safe diagnostics, durable audit receipt and attributable cost',
      },
      '053-delivery-readiness': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Trusted protected-source OIDC, immutable artifact/config/reference manifest, generation fence, migration backup gate and vector rollback',
      },
      '054-azure-resilience': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Tenant-bound quarantine recovery gate with duplicate-effect, rollback-vector and declared RPO/RTO fences',
      },
      '055-azure-close': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Authorized admission-drain/evidence-export close gate that deletes only exact manifest inventory and preserves held evidence',
      },
      '056-provider-certification-harness': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Provider-neutral allow/deny/pagination/throttle/idempotency/timeout/reconciliation/credential/reset suite with trusted live-label and recording-safety gate',
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
