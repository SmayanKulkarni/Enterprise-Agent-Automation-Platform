import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PATTERNS = ['apps/*', 'packages/*'];
const REQUIRED_SCRIPTS = ['lint', 'test', 'typecheck', 'verify', 'workspace:check'];
const REQUIRED_COMPILER_OPTIONS = {
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
};
const CONFIG_FILES = [
  '.node-version',
  'eslint.config.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
];
const SKIPPED_DIRECTORIES = new Set(['.artifacts', '.git', '.pnpm-store', '.scratch', '.superpowers', 'node_modules']);
const OUTPUT_DIRECTORIES = new Set(['build', 'coverage', 'dist', 'lib', 'out']);

/** @typedef {{ manifest: Record<string, any>, name: string, path: string }} WorkspacePackage */

export class WorkspaceValidationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'WorkspaceValidationError';
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  throw new WorkspaceValidationError(code, message);
}

/**
 * @param {string} path
 * @param {string} code
 * @returns {Record<string, any>}
 */
function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(code, `Cannot read valid JSON from ${path}.`);
  }
}

/** @param {string} root @param {string} target */
function isWithin(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

/** @param {string} root */
function parseWorkspacePatterns(root) {
  const workspacePath = resolve(root, 'pnpm-workspace.yaml');
  let lines;
  try {
    lines = readFileSync(workspacePath, 'utf8').split(/\r?\n/u);
  } catch {
    fail('INVALID_WORKSPACE_MEMBERSHIP', 'pnpm-workspace.yaml is required.');
  }

  const meaningful = lines.map((line) => line.trim()).filter(Boolean);
  if (meaningful[0] !== 'packages:') {
    fail('INVALID_WORKSPACE_MEMBERSHIP', 'Workspace membership must declare a packages list.');
  }

  const patterns = meaningful.slice(1).map((line) => {
    if (!line.startsWith('- ')) {
      fail('INVALID_WORKSPACE_MEMBERSHIP', 'Workspace membership contains unsupported YAML.');
    }
    return line.slice(2).replace(/^['"]|['"]$/gu, '');
  });

  if (JSON.stringify(patterns) !== JSON.stringify(EXPECTED_PATTERNS)) {
    fail(
      'INVALID_WORKSPACE_MEMBERSHIP',
      `Workspace membership must be exactly: ${EXPECTED_PATTERNS.join(', ')}.`,
    );
  }

  for (const pattern of patterns) {
    const base = resolve(root, pattern.slice(0, -2));
    if (!isWithin(root, base)) {
      fail('INVALID_WORKSPACE_MEMBERSHIP', 'Workspace membership escapes the repository.');
    }
  }

  return patterns;
}

/** @param {string} root */
function assertRootConfiguration(root) {
  const packageJson = readJson(resolve(root, 'package.json'), 'INVALID_ROOT_CONFIGURATION');
  if (packageJson['private'] !== true || typeof packageJson['packageManager'] !== 'string') {
    fail('INVALID_ROOT_CONFIGURATION', 'The root package must be private and pin pnpm.');
  }

  const pnpmVersion = packageJson['packageManager'].match(/^pnpm@(\d+\.\d+\.\d+)$/u)?.[1];
  const nodeVersion = readFileSync(resolve(root, '.node-version'), 'utf8').trim();
  if (
    pnpmVersion === undefined ||
    packageJson['engines']?.['pnpm'] !== pnpmVersion ||
    packageJson['engines']?.['node'] !== nodeVersion
  ) {
    fail('INVALID_ROOT_CONFIGURATION', 'Toolchain pins must agree across package.json and .node-version.');
  }

  for (const script of REQUIRED_SCRIPTS) {
    if (typeof packageJson['scripts']?.[script] !== 'string' || packageJson['scripts'][script].length === 0) {
      fail('INVALID_ROOT_CONFIGURATION', `The root ${script} script is required.`);
    }
  }

  return { node: nodeVersion, pnpm: pnpmVersion };
}

/** @param {string} root */
function assertStrictCompilerSettings(root) {
  const baseConfig = readJson(resolve(root, 'tsconfig.base.json'), 'RELAXED_COMPILER_SETTINGS');
  for (const [option, requiredValue] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
    if (baseConfig['compilerOptions']?.[option] !== requiredValue) {
      fail('RELAXED_COMPILER_SETTINGS', `Compiler option ${option} must be ${String(requiredValue)}.`);
    }
  }
}

/**
 * @param {string} root
 * @param {(target: string, entry: import('node:fs').Dirent) => void} visitor
 * @param {string} [directory]
 */
function walk(root, visitor, directory = root) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        visitor(target, entry);
        walk(root, visitor, target);
      }
    } else {
      visitor(target, entry);
    }
  }
}

/**
 * @param {string} root
 * @param {string[]} patterns
 * @returns {WorkspacePackage[]}
 */
function discoverPackages(root, patterns) {
  /** @type {WorkspacePackage[]} */
  const packages = [];
  for (const pattern of patterns) {
    const parent = resolve(root, pattern.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const packageRoot = resolve(parent, entry.name);
      const manifestPath = resolve(packageRoot, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath, 'INVALID_WORKSPACE_MEMBERSHIP');
      if (typeof manifest['name'] !== 'string' || manifest['name'].length === 0) {
        fail('INVALID_WORKSPACE_MEMBERSHIP', `Workspace package at ${relative(root, packageRoot)} has no name.`);
      }
      packages.push({ manifest, name: manifest['name'], path: relative(root, packageRoot).replaceAll('\\', '/') });
    }
  }
  packages.sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(packages.map(({ name }) => name)).size !== packages.length) {
    fail('INVALID_WORKSPACE_MEMBERSHIP', 'Workspace package names must be unique.');
  }
  return packages;
}

/** @param {WorkspacePackage[]} packages */
function assertAcyclic(packages) {
  const packageNames = new Set(packages.map(({ name }) => name));
  const dependencies = new Map(
    packages.map(({ manifest, name }) => {
      const declared = {
        ...manifest['dependencies'],
        ...manifest['devDependencies'],
        ...manifest['optionalDependencies'],
        ...manifest['peerDependencies'],
      };
      return [name, Object.keys(declared).filter((dependency) => packageNames.has(dependency)).sort()];
    }),
  );
  const visiting = new Set();
  const visited = new Set();

  /** @param {string} name @param {string[]} trail */
  function visit(name, trail) {
    if (visiting.has(name)) {
      fail('DEPENDENCY_CYCLE', `Workspace dependency cycle: ${[...trail, name].join(' -> ')}.`);
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of dependencies.get(name) ?? []) visit(dependency, [...trail, name]);
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of [...packageNames].sort()) visit(name, []);
}

/** @param {string} root */
function scanOutputsAndConfigs(root) {
  /** @type {string[]} */
  const paths = [];
  walk(root, (target, entry) => {
    if (!isWithin(root, target)) {
      fail('OUT_OF_SCOPE_BUILD_OUTPUT', 'Repository scan escaped its root.');
    }
    if (entry.isDirectory() && OUTPUT_DIRECTORIES.has(entry.name)) {
      paths.push(relative(root, target).replaceAll('\\', '/'));
    }
    if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) {
      paths.push(relative(root, target).replaceAll('\\', '/'));
    }
    if (entry.isFile() && /^tsconfig(?:\.[^.]+)?\.json$/u.test(entry.name)) {
      const config = readJson(target, 'RELAXED_COMPILER_SETTINGS');
      const outDir = config['compilerOptions']?.['outDir'];
      if (typeof outDir === 'string' && !isWithin(root, resolve(dirname(target), outDir))) {
        fail('OUT_OF_SCOPE_BUILD_OUTPUT', `Compiler output for ${relative(root, target)} escapes the repository.`);
      }
    }
  });
  return [...new Set(paths)].sort();
}

/** @param {string} root */
function digestConfigurations(root) {
  return CONFIG_FILES.filter((path) => existsSync(resolve(root, path)))
    .map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex'),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/** @param {string} rootDirectory */
export function validateWorkspace(rootDirectory) {
  const root = resolve(rootDirectory);
  if (!statSync(root).isDirectory()) fail('INVALID_ROOT_CONFIGURATION', 'Workspace root must be a directory.');
  const workspacePatterns = parseWorkspacePatterns(root);
  const toolchain = assertRootConfiguration(root);
  assertStrictCompilerSettings(root);
  const discoveredPackages = discoverPackages(root, workspacePatterns);
  assertAcyclic(discoveredPackages);
  const outputPaths = scanOutputsAndConfigs(root);

  return {
    configDigests: digestConfigurations(root),
    outputScan: { paths: outputPaths, repositoryBounded: true },
    packages: discoveredPackages.map(({ name, path }) => ({ name, path })),
    toolchain,
    workspacePatterns,
  };
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify({ ok: true, report: validateWorkspace(process.cwd()) }));
  } catch (error) {
    const code = error instanceof WorkspaceValidationError ? error.code : 'WORKSPACE_CHECK_FAILED';
    const message = error instanceof Error ? error.message : 'Unknown workspace validation failure.';
    console.error(JSON.stringify({ error: { code, message }, ok: false }));
    process.exitCode = 1;
  }
}
