/** Package the installed production closure, including peers and licenses.
 * Resolve from each real source package so pnpm's isolated dependency graph is
 * preserved. Never resolve a different version from a registry while exporting.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

function manifest(source) { return JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')); }
function dependency(source, name, optional) {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu.test(name)) throw new Error('Invalid dependency name.');
  const paths = createRequire(join(source, 'package.json')).resolve.paths(name) ?? [];
  for (const path of paths) {
    const candidate = join(path, name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
  }
  if (optional) return undefined;
  throw new Error(`Missing installed production dependency ${name} of ${manifest(source).name}. Run pnpm install --frozen-lockfile before packaging.`);
}
function dependencies(pkg) {
  const result = new Map();
  for (const name of Object.keys(pkg.peerDependencies ?? {})) result.set(name, pkg.peerDependenciesMeta?.[name]?.optional === true);
  for (const name of Object.keys(pkg.dependencies ?? {})) result.set(name, false);
  for (const name of Object.keys(pkg.optionalDependencies ?? {})) result.set(name, true);
  return result;
}
function copyFiles(source, target, workspace) {
  mkdirSync(target, { recursive: true });
  if (workspace && !existsSync(join(source, 'dist'))) throw new Error(`Build ${manifest(source).name} before packaging.`);
  for (const entry of readdirSync(source)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'standalone') continue;
    if (workspace && !['package.json', 'dist', 'bin'].includes(entry) && !/^(?:readme|license|copying|notice)(?:\.|$)/iu.test(entry)) continue;
    cpSync(join(source, entry), join(target, entry), { recursive: true, dereference: true,
      filter: path => !['node_modules', '.git'].includes(basename(path)) });
  }
}
function copyTree(source, target, ancestors, budget, depth = 0) {
  if (++budget.packages > 1024 || depth > 64) throw new Error('Production dependency closure exceeds packaging bounds.');
  const pkg = manifest(source);
  copyFiles(source, target, pkg.name === 'cli' || pkg.name?.startsWith('@workspace/'));
  const found = [];
  const visible = new Map(ancestors); visible.set(pkg.name, source);
  for (const [name, optional] of dependencies(pkg)) {
    const location = dependency(source, name, optional);
    if (!location) continue;
    if (visible.get(name) !== location) found.push([name, location]);
    visible.set(name, location);
  }
  for (const [name, location] of found) copyTree(location, join(target, 'node_modules', name), visible, budget, depth + 1);
}
export function packageStandalone(sourceDirectory, outputDirectory) {
  const source = realpathSync(sourceDirectory); const output = resolve(outputDirectory);
  if (source === output || source.startsWith(`${output}/`)) throw new Error('Package output must not replace the source checkout.');
  mkdirSync(dirname(output), { recursive: true });
  const staging = mkdtempSync(join(dirname(output), '.llame-package-'));
  const prepared = join(staging, 'package'); const previous = join(staging, 'previous');
  let backedUp = false;
  try {
    copyTree(source, prepared, new Map(), { packages: 0 });
    // The monorepo license covers first-party packages; third-party packages
    // retain all their own licenses/notices in the copied package directories.
    const license = join(source, '../../LICENSE');
    if (existsSync(license)) cpSync(license, join(prepared, 'LICENSE'));
    if (existsSync(output)) { renameSync(output, previous); backedUp = true; }
    try { renameSync(prepared, output); }
    catch (error) { if (backedUp) renameSync(previous, output); throw error; }
  } finally { rmSync(staging, { recursive: true, force: true }); }
  return output;
}
