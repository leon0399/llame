import { posix } from 'node:path';

import {
  isSelectorSuffix,
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import {
  formatMachineLocator,
  isMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import { isFileAlias } from './permissions/file-alias';

export type WorkspaceRootCell = {
  current(): string | undefined;
  commit(root: string | undefined): void;
  claimTransition(): boolean;
};

export function createWorkspaceRootCell(
  initial: string | undefined,
): WorkspaceRootCell & { beginStep(): void } {
  let currentRoot = initial;
  let pendingRoot = initial;
  let transitionClaimed = false;
  return {
    current: () => currentRoot,
    commit: (root) => {
      pendingRoot = root;
    },
    beginStep: () => {
      currentRoot = pendingRoot;
      transitionClaimed = false;
    },
    claimTransition: () => {
      if (transitionClaimed) return false;
      transitionClaimed = true;
      return true;
    },
  };
}

/** The Machine a Workspace root names, and the absolute path it is bound to. */
export type MachineWorkspaceRoot = {
  readonly name: string;
  readonly path: string;
};

/**
 * A Machine Workspace root is `machine://<name><absolute path>`; a local root
 * is an absolute host path. Anything else (a relative root, a listing form, a
 * root naming no path) is not a Workspace root at all.
 */
export function machineWorkspaceRoot(
  root: string | undefined,
): MachineWorkspaceRoot | undefined {
  if (root === undefined || !isMachineLocator(root)) return undefined;
  const parsed = parseMachineLocator(root);
  return parsed.kind === 'path'
    ? { name: parsed.name, path: parsed.path }
    : undefined;
}

/**
 * Map a bare absolute path to the Machine locator when the Workspace root is
 * on a Machine: while a Chat is bound to a Machine Workspace, an absolute path
 * addresses the Machine's filesystem, so it must be evaluated and executed as
 * the same address. A `file:` alias, another scheme, a relative path, and every
 * root that is not a Machine are returned unchanged.
 */
export function mapToWorkspaceHost(
  root: string | undefined,
  value: string,
): string {
  const machine = machineWorkspaceRoot(root);
  if (machine === undefined || !value.startsWith('/')) return value;
  return machineLocator(machine.name, value) ?? value;
}

/**
 * A relative path resolves from the Workspace root. On a Machine root it
 * becomes the Machine's own locator; a selected path keeps its read selector.
 * The root must be an absolute host path or a Machine locator: anything else
 * fails closed, so an unmigrated call site can never silently resolve against
 * a root this module does not understand.
 */
export function resolveWorkspacePath(root: string, value: string): string {
  const machine = machineWorkspaceRoot(root);
  if (machine !== undefined) {
    if (!isWorkspaceRelative(value)) return mapToWorkspaceHost(root, value);
    const resolved = posix.resolve(machine.path, value);
    const trailing =
      value.endsWith('/') && resolved !== '/' ? `${resolved}/` : resolved;
    const locator = machineLocator(machine.name, trailing);
    if (locator === undefined)
      throw new Error('The Machine Workspace path cannot be a locator.');
    return locator;
  }
  if (!root.startsWith('/'))
    throw new Error(
      'A Workspace root must be an absolute host path or a machine:// locator.',
    );
  const resolved = posix.resolve(root, value);
  return value.endsWith('/') && resolved !== '/' ? `${resolved}/` : resolved;
}

/**
 * The canonical locator text of a `machine://` address: scheme and name
 * lowercase, the path decoded and re-encoded once, a valid read selector kept
 * as a selector. A listing or malformed locator has no canonical path form and
 * is returned as written, so it is matched as the model wrote it.
 */
export function canonicalMachineLocator(value: string): string {
  if (!isMachineLocator(value)) return value;
  const parsed = parseMachineLocator(value);
  if (parsed.kind !== 'path') return value;
  return (
    formatMachineLocator(parsed.name, parsed.path, parsed.selector) ?? value
  );
}

export function isWorkspaceRelative(value: string): boolean {
  return (
    !value.startsWith('/') &&
    !isFileAlias(value) &&
    parsePathScheme(value) === undefined
  );
}

/**
 * The canonical locator for one absolute Machine path, with a trailing read
 * selector kept as a selector rather than encoded into the filename.
 */
function machineLocator(name: string, value: string): string | undefined {
  const split = splitSelectorSuffix(value);
  const selector =
    split.selector !== undefined && isSelectorSuffix(split.selector)
      ? split.selector
      : undefined;
  return formatMachineLocator(
    name,
    selector === undefined ? value : split.path,
    selector,
  );
}
