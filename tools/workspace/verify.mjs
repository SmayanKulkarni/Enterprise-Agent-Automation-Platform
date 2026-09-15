import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateWorkspace } from './check-workspace.mjs';
import { buildWorkspaceEvidence, publishEvidence } from './evidence.mjs';

const COMMANDS = [
  { args: ['pnpm', 'run', 'workspace:check'], command: 'pnpm workspace:check', name: 'workspace:check' },
  { args: ['pnpm', 'run', 'contracts'], command: 'pnpm contracts', name: 'contracts' },
  { args: ['pnpm', 'run', 'lint'], command: 'pnpm lint', name: 'lint' },
  { args: ['pnpm', 'run', 'typecheck'], command: 'pnpm typecheck', name: 'typecheck' },
  { args: ['pnpm', 'run', 'test'], command: 'pnpm test', name: 'test' },
];

/** @typedef {{command: string, exitCode: number, name: string}} CommandResult */
/** @typedef {{node: string, pnpm: string}} Toolchain */
/** @typedef {{args: string[], command: string, name: string}} VerificationCommand */

export class VerificationError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'VerificationError';
  }
}

/** @returns {never} @param {string} code @param {string} message */
function fail(code, message) {
  throw new VerificationError(code, message);
}

/** @param {VerificationCommand} descriptor @returns {CommandResult} */
function runRootCommand(descriptor) {
  const result = spawnSync(resolve(dirname(process.execPath), 'corepack'), descriptor.args, {
    encoding: 'utf8',
    env: { ...process.env, PNPM_DISABLE_SELF_UPDATE_CHECK: 'true' },
    stdio: 'pipe',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    command: descriptor.command,
    exitCode: result.status ?? 1,
    name: descriptor.name,
  };
}

/** @returns {Toolchain} */
function readActualToolchain() {
  const result = spawnSync(resolve(dirname(process.execPath), 'corepack'), ['pnpm', '--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) fail('TOOLCHAIN_UNAVAILABLE', 'Cannot execute the pinned pnpm toolchain.');
  return { node: process.version.replace(/^v/u, ''), pnpm: result.stdout.trim() };
}

/**
 * @param {string} rootDirectory
 * @param {{
 *   getActualToolchain?: () => Toolchain,
 *   runCommand?: (descriptor: VerificationCommand) => CommandResult
 * }} [ports]
 */
export function verifyWorkspace(rootDirectory, ports = {}) {
  const root = resolve(rootDirectory);
  const initialReport = validateWorkspace(root);
  const actualToolchain = (ports.getActualToolchain ?? readActualToolchain)();
  if (
    actualToolchain.node !== initialReport.toolchain.node ||
    actualToolchain.pnpm !== initialReport.toolchain.pnpm
  ) {
    fail(
      'TOOLCHAIN_MISMATCH',
      `Expected Node ${initialReport.toolchain.node} and pnpm ${initialReport.toolchain.pnpm}.`,
    );
  }

  const runCommand = ports.runCommand ?? runRootCommand;
  /** @type {CommandResult[]} */
  const commands = [];
  for (const descriptor of COMMANDS) {
    const result = runCommand(descriptor);
    commands.push(result);
    if (result.exitCode !== 0) {
      fail('ROOT_COMMAND_FAILED', `${descriptor.command} failed with exit code ${String(result.exitCode)}.`);
    }
  }

  const finalReport = validateWorkspace(root);
  const evidence = buildWorkspaceEvidence({ commands, report: finalReport, toolchain: actualToolchain });
  const manifestPath = publishEvidence(root, evidence);
  return { commands, manifestPath, report: finalReport };
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyWorkspace(process.cwd());
    console.log(
      JSON.stringify({
        manifest: result.manifestPath,
        ok: true,
        packages: result.report.packages,
      }),
    );
  } catch (error) {
    const code = error instanceof VerificationError ? error.code : 'VERIFY_FAILED';
    const message = error instanceof Error ? error.message : 'Unknown verification failure.';
    console.error(JSON.stringify({ error: { code, message }, ok: false }));
    process.exitCode = 1;
  }
}
