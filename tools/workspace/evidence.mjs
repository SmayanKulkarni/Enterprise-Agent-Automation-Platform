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
      '009b-live-clerk-integration': {
        checks: ['tests/platform/gateway-browser.test.ts'],
        interface: 'Official Clerk Backend SDK session-token verification, active-session recheck and browser bearer-header helper',
        issue: '.scratch/platform-implementation/issues/009b-live-clerk-integration.md',
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
      '021-credentials': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Reference-only fake secret store, scoped invocation-local acquisition, probe-then-switch rotation, epoch cache invalidation and revocation receipts',
        issue: '.scratch/platform-implementation/issues/021-credentials.md',
      },
      '022-extension-isolation': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Disposable local ExtensionRunner with default-deny network/resource policy, immutable invocation input and output DLP/size gate',
        issue: '.scratch/platform-implementation/issues/022-extension-isolation.md',
      },
      '023-lifecycle-integration': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Epoch-bound provider readiness, atomic checked release upgrade, callback fence and reconciled removal',
        issue: '.scratch/platform-implementation/issues/023-lifecycle-integration.md',
      },
      '024-provenance-graph': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Immutable Tenant-scoped provenance records, parent validation, acyclic lineage and immediate eligibility epochs',
        issue: '.scratch/platform-implementation/issues/024-provenance-graph.md',
      },
      '025-scoped-stores': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Authority, consent, policy, retention and explicit-scope governed in-memory/relational write-read adapters',
        issue: '.scratch/platform-implementation/issues/025-scoped-stores.md',
      },
      '026-retrieval': {
        checks: ['tests/platform/lifecycle-memory.test.ts'],
        interface: 'Eligibility-before-ranking query, provenance projections, graph-epoch cache key, bounded result budgets and non-widening unavailable-adapter fallback',
        issue: '.scratch/platform-implementation/issues/026-retrieval.md',
      },
      '039-change-lifecycle': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'SolutionLifecycle compatible activation change, immutable migration checkpoint, rollback disposition, quarantine and hold/retire fences',
        issue: '.scratch/platform-implementation/issues/039-change-lifecycle.md',
      },
      '039a-studio-catalog-view': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'browser.v1 Tenant-scoped packages/installations projection routes and owner-command boundary',
        issue: '.scratch/platform-implementation/issues/039a-studio-catalog-view.md',
      },
      '040-operations-intake': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'OperationsRuntime packed operations.event decode, correlation/causation-preserving safe transform, idempotent dedupe and non-leaking quarantine',
        issue: '.scratch/platform-implementation/issues/040-operations-intake.md',
      },
      '041-operations-projection': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Deterministic Tenant projection with source versions, watermark, gap completeness and Tenant-bound cursor',
        issue: '.scratch/platform-implementation/issues/041-operations-projection.md',
      },
      '041a-mongo-operations-read-model': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Disposable Mongo-shaped safe snapshot read model with exact Tenant partition purge and rebuild equivalence',
        issue: '.scratch/platform-implementation/issues/041a-mongo-operations-read-model.md',
      },
      '042-signals-cost': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Append-only audit evidence, bounded safe projections and explicit estimated/final/unknown/shared rate-versioned cost states',
        issue: '.scratch/platform-implementation/issues/042-signals-cost.md',
      },
      '043-operations-commands': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Fresh-authority exact-digest owner command transport with stored retry receipt and separate projection catch-up state',
        issue: '.scratch/platform-implementation/issues/043-operations-commands.md',
      },
      '043a-operations-browser': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Safe OperationsWorkbench projection and approval/manifest-fenced owner command intent',
        issue: '.scratch/platform-implementation/issues/043a-operations-browser.md',
      },
      '044-operations-experience': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Tenant-scoped operational evidence/cost projection plus versioned runbook alert fire/group/clear state',
        issue: '.scratch/platform-implementation/issues/044-operations-experience.md',
      },
      '045-technical-implementation-package': {
        checks: ['tests/platform/operations-lifecycle.test.ts'],
        interface: 'Signed fixture-only Technical Implementation package carrying exact SQL/Blob/Boards capabilities through shared activation',
        issue: '.scratch/platform-implementation/issues/045-technical-implementation-package.md',
      },
      '046-deterministic-tools': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Version-fenced public bootstrap, seed and readiness commands with two-Tenant fixture inventory and digests',
        issue: '.scratch/platform-implementation/issues/046-deterministic-tools.md',
      },
      '047-technical-implementation-success': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Fixture-only Technical Implementation Case with information intervention, exact package pin, SQL/Blob/Boards receipts and evaluation evidence',
        issue: '.scratch/platform-implementation/issues/047-technical-implementation-success.md',
      },
      '048-technical-implementation-negatives-recovery': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Labeled local denial, stale approval, throttle, conflict, reconciliation and replay recovery manifest',
        issue: '.scratch/platform-implementation/issues/048-technical-implementation-negatives-recovery.md',
      },
      '049-reset-repeat': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Paired deterministic run digests plus exact reset/resume, held-evidence and foreign-object residual reports',
        issue: '.scratch/platform-implementation/issues/049-reset-repeat.md',
      },
      '049a-technical-browser-journey': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Registered browser.v1 Case run/reset commands requiring current Tenant proof and exact seeded fixture version',
        issue: '.scratch/platform-implementation/issues/049a-technical-browser-journey.md',
      },
      '050-policy-iac-shell': {
        checks: ['tests/platform/technical-implementation.test.ts'],
        interface: 'Bicep policy-tag shell and fail-closed environment plan allowlist for region, SKU, tags, lease, scope, cost and destructive target',
        issue: '.scratch/platform-implementation/issues/050-policy-iac-shell.md',
      },
      '051-foundations-data': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Private-ingress, least-privilege foundation inventory with reference-only configuration, backup coverage and Tenant-scoped quarantine restore',
        issue: '.scratch/platform-implementation/issues/051-foundations-data.md',
      },
      '052-compute-telemetry': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Managed-identity internal compute port with no ambient network handles, safe diagnostics, durable audit receipt and attributable cost',
        issue: '.scratch/platform-implementation/issues/052-compute-telemetry.md',
      },
      '053-delivery-readiness': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Trusted protected-source OIDC, immutable artifact/config/reference manifest, generation fence, migration backup gate and vector rollback',
        issue: '.scratch/platform-implementation/issues/053-delivery-readiness.md',
      },
      '054-azure-resilience': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Tenant-bound quarantine recovery gate with duplicate-effect, rollback-vector and declared RPO/RTO fences',
        issue: '.scratch/platform-implementation/issues/054-azure-resilience.md',
      },
      '055-azure-close': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Authorized admission-drain/evidence-export close gate that deletes only exact manifest inventory and preserves held evidence',
        issue: '.scratch/platform-implementation/issues/055-azure-close.md',
      },
      '056-provider-certification-harness': {
        checks: ['tests/platform/deployment-provider.test.ts'],
        interface: 'Provider-neutral allow/deny/pagination/throttle/idempotency/timeout/reconciliation/credential/reset suite with trusted live-label and recording-safety gate',
        issue: '.scratch/platform-implementation/issues/056-provider-certification-harness.md',
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
