import { ExecutorGitError } from '../machines/executor-git-error';
import {
  formatMachineLocator,
  isMachineLocator,
} from '../machines/machine-locator';
import { type ExecutorTarget } from '../machines/executor-git.service';
import { type WorkspaceAuthority } from './workspace-binding';
import {
  canonicalMachineLocator,
  machineWorkspaceRoot,
  type MachineWorkspaceRoot,
} from './workspace-path';

/**
 * The Machine one worktree entry runs on. The executor surface accepts every
 * address as its canonical locator and reads the Machine name from it, so the
 * flow keeps one form — the locator — and decodes it only where placement does
 * lexical math.
 */
export type EntryMachine = {
  /** The Machine name: the executor id the rows record. */
  readonly name: string;
  /** The executor `git` runs on. */
  readonly target: ExecutorTarget;
  /** The canonical locator of one path or stored address on the Machine. */
  readonly locator: (address: string) => string;
  /** The absolute path on the Machine of a locator or a legacy stored path. */
  readonly pathOf: (address: string) => string;
};

/**
 * The Machine of one already-decided canonical source root. The caller has
 * decided the locator, so this only refuses a value that names no single
 * Machine path, then derives the executor target and the two conversions.
 */
export function entryMachine(input: {
  readonly authority: WorkspaceAuthority;
  readonly canonical: string;
}): EntryMachine {
  const root = machineRootOf(input.canonical);

  return {
    name: root.name,
    target: {
      executorId: input.authority.executorId,
      machine: root.name,
      path: root.path,
    },
    locator: (address) =>
      isMachineLocator(address)
        ? canonicalMachineLocator(address)
        : locatorOf(root.name, address),
    pathOf: (address) => machineWorkspaceRoot(address)?.path ?? address,
  };
}

/** The Machine and path a canonical source root names. */
function machineRootOf(canonical: string): MachineWorkspaceRoot {
  const root = machineWorkspaceRoot(canonical);

  if (root === undefined) {
    throw new ExecutorGitError(
      'invalid_path',
      'The canonical Machine address does not name one absolute path.',
    );
  }

  return root;
}

function locatorOf(name: string, path: string): string {
  const locator = formatMachineLocator(name, path);

  if (locator === undefined) {
    throw new ExecutorGitError(
      'invalid_path',
      'This path cannot be written as a Machine locator.',
    );
  }

  return locator;
}
