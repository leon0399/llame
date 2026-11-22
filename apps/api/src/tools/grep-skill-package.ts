/**
 * One `skill://` package scope: the directory the catalog published and the
 * raw resource path the model wrote. An operator package is a host path this
 * process walks; a Workspace package is a `machine://` locator its Machine
 * walks (remote-machines "Machine Workspace skills come from the Machine"),
 * whether that Machine is this process's own or another one.
 */

import path from 'node:path';

import { normalizeHostScope } from '@workspace/native-file-tools';

import { parseMachineLocator } from '../machines/machine-locator';
import {
  formatSkillLocator,
  validateSkillResourcePath,
} from '../skills/skill-locator';
import { skillUnavailableResult } from '../skills/skill-target';
import { type GrepReadAdmission } from './grep-admission';
import { resolveParsedMachineScope } from './grep-machine';
import { createSkillWalkPort, joinedPath, probeSkillPath } from './grep-ports';
import {
  buildScope,
  splitScopePath,
  type ScopeOutcome,
} from './grep-scope-shape';
import { type ToolContext } from './types';

export type SkillPackageScope = {
  readonly context: ToolContext;
  readonly skillDirectory: string;
  readonly name: string;
  readonly rawPath: string;
  readonly index: number;
  readonly admission: GrepReadAdmission;
  readonly signal: AbortSignal | undefined;
  /** The absolute instant the walk stops, which bounds a Machine package's probe. */
  readonly deadlineAt: number;
};

/**
 * One package's scope: the raw path part split at its first glob segment, then
 * probed only when it names one path. No package scope is ever walked on a
 * Machine's paths as host paths: a Machine locator goes back to its daemon.
 */
export async function resolveSkillPackage(
  input: SkillPackageScope,
): Promise<ScopeOutcome> {
  const parsed = splitScopePath(input.rawPath, isSkillResourcePath);

  if ('status' in parsed) return { result: parsed };

  const machine = machinePackageOf(input.skillDirectory);

  if (machine !== undefined)
    return resolveMachineSkillPackage(input, { machine, parsed });

  if (!path.isAbsolute(input.skillDirectory)) {
    return { result: skillUnavailableResult() };
  }

  const root =
    parsed.prefixPath.length === 0
      ? input.skillDirectory
      : path.join(input.skillDirectory, ...parsed.prefixPath.split('/'));

  return buildScope({
    index: input.index,
    locatorFor: skillPackageLocator(input.name, parsed.prefixPath),
    glob: parsed.glob,
    port: () => createSkillWalkPort(root, input.signal),
    probe: () => probeSkillPath(root, input.signal),
    endsWithSeparator: parsed.endsWithSeparator,
    admission: input.admission,
  });
}

/** The Machine a package directory lives on, when the directory is a locator. */
function machinePackageOf(
  directory: string,
): { readonly name: string; readonly path: string } | undefined {
  const parsed = parseMachineLocator(directory);

  return parsed.kind === 'path'
    ? { name: parsed.name, path: parsed.path }
    : undefined;
}

/** One Machine package: its Machine, and the resource path the scope names. */
type MachineSkillPackage = {
  readonly machine: { readonly name: string; readonly path: string };
  readonly parsed: {
    readonly prefixPath: string;
    readonly globSuffix: string | undefined;
    readonly endsWithSeparator: boolean;
  };
};

/**
 * One package on a Machine: the Machine's daemon walks the package path, and
 * every path it reports is spelled as the `skill://` locator the package
 * names, so the `read` group and the result see the package rather than a
 * Machine path the catalog keeps.
 */
async function resolveMachineSkillPackage(
  input: SkillPackageScope,
  target: MachineSkillPackage,
): Promise<ScopeOutcome> {
  const { machine, parsed } = target;

  return resolveParsedMachineScope(
    input.context,
    {
      index: input.index,
      name: machine.name,
      path: normalizeHostScope(packagePath(machine.path, parsed.prefixPath)),
      globSuffix: parsed.globSuffix,
      endsWithSeparator: parsed.endsWithSeparator,
      locatorOf: skillPackageLocator(input.name, parsed.prefixPath),
    },
    input.admission,
    input.deadlineAt,
  );
}

/** The absolute Machine path a package's resource path names. */
function packagePath(packageDirectory: string, prefixPath: string): string {
  return prefixPath.length === 0
    ? packageDirectory
    : path.posix.join(packageDirectory, ...prefixPath.split('/'));
}

/** The `skill://` locator of every path relative to a package's prefix. */
function skillPackageLocator(
  name: string,
  prefixPath: string,
): (rel: string) => string {
  return (rel) => {
    const relativePath = joinedPath(prefixPath, rel);

    return formatSkillLocator(
      relativePath.length === 0 ? { name } : { name, relativePath },
    );
  };
}

function isSkillResourcePath(relativePath: string): boolean {
  return (
    relativePath.length === 0 ||
    validateSkillResourcePath(relativePath) !== undefined
  );
}
