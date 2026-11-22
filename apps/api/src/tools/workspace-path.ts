import { posix } from 'node:path';

import {
  isSelectorSuffix,
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import { JOB_SCHEME } from '../jobs/job-locator';
import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
import {
  formatMachineLocator,
  isMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import { MEDIA_LOCATOR_SCHEME } from '../media/media-locator';
import { PROJECT_SCHEME } from '../projects/project-locator';
import { SKILL_LOCATOR_SCHEME } from '../skills/skill-locator';
import { SSH_SCHEME } from '../ssh/ssh-locator';
import { ARTIFACT_SCHEME } from './artifacts/locator';
import { decodeFileAlias, isFileAlias } from './permissions/file-alias';

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

/** A bare path with no Machine to resolve it on. */
export const NO_CURRENT_MACHINE_MESSAGE =
  'No current Machine: configure machines.default or enter a Workspace.';

const NO_WORKSPACE_ROOT_MESSAGE =
  'A relative path needs an entered Workspace to resolve from.';

/** The refusal an unimplemented scheme already returns. */
const UNKNOWN_SCHEME_MESSAGE = 'This path scheme is not available.';

const BAD_MACHINE_PATH_MESSAGE =
  'A Machine path must be absolute and contain no NUL bytes.';

/**
 * The trusted facts a locator resolves against: the entered Workspace root,
 * `machines.default`, and `machines.local`, all taken from the ToolContext and
 * never from model arguments.
 */
export type LocatorContext = {
  readonly workspaceRoot?: string;
  readonly defaultMachine?: string;
  readonly localMachine?: string;
};

/**
 * The trusted locator facts of one call, from the ToolContext and never from
 * model arguments: the entered Workspace root, `machines.default`, and
 * `machines.local`.
 */
export function locatorContext(context: {
  readonly workspaceRoot?: { current(): string | undefined };
  readonly defaultMachine?: string;
  readonly localMachine?: string;
}): LocatorContext {
  return {
    workspaceRoot: context.workspaceRoot?.current(),
    defaultMachine: context.defaultMachine,
    localMachine: context.localMachine,
  };
}

/**
 * The Machine a path of this call addresses: the bound Workspace root's
 * Machine, else `machines.default`. A legacy bare Workspace root carries no
 * Machine name of its own, so it is read on `machines.default` — the Machine
 * the Chat was bound to when the root was written.
 */
export function currentMachine(context: LocatorContext): string | undefined {
  const bound = machineWorkspaceRoot(context.workspaceRoot);

  return bound === undefined ? context.defaultMachine : bound.name;
}

/** One address on one Machine: the decoded path and its canonical text. */
export type MachineTarget = {
  readonly kind: 'machine';
  /** Lowercase Machine name. */
  readonly name: string;
  /** Decoded absolute POSIX path, trailing separator kept. */
  readonly path: string;
  readonly locator: string;
  /** A read selector split off `path`, exactly as written. */
  readonly selector?: string;
};

export type ResolvedLocator =
  | MachineTarget
  | { readonly kind: 'scheme' }
  | { readonly kind: 'invalid'; readonly message: string };

/** The schemes whose readers keep their own routing, in either case. */
const LOCATOR_SCHEMES: ReadonlySet<string> = new Set([
  KNOWLEDGE_LOCATOR_SCHEME,
  SKILL_LOCATOR_SCHEME,
  MEDIA_LOCATOR_SCHEME,
  JOB_SCHEME,
  PROJECT_SCHEME,
  ARTIFACT_SCHEME,
  SSH_SCHEME,
  'http',
  'https',
]);

/**
 * The one locator rule (design D6), for a path without a read selector. A
 * bare absolute path and every valid `file:` form resolve on the current
 * Machine; a relative path resolves lexically from the Workspace root on that
 * root's Machine; `machine://<name>/<path>` names its Machine; a listing form
 * and every other locator scheme keep the caller's routing; anything else is
 * a refusal with the reader's own message.
 */
export function resolveMachinePath(
  value: string,
  context: LocatorContext,
): ResolvedLocator {
  // The `file:` classifier runs before any other classification, so an alias
  // is never read as a relative path or as an unknown scheme.
  if (isFileAlias(value)) {
    const alias = decodeFileAlias(value);

    if (!alias.ok) return { kind: 'invalid', message: alias.message };

    return machineTarget(currentMachine(context), alias.hostPath);
  }

  if (isMachineLocator(value)) {
    const parsed = parseMachineLocator(value);

    if (parsed.kind === 'invalid')
      return { kind: 'invalid', message: parsed.message };

    if (parsed.kind !== 'path') return { kind: 'scheme' };

    // The parser split the selector off the raw locator before decoding, so a
    // percent-encoded colon is path text and the decoded path is read as is.
    return machineTarget(parsed.name, parsed.path, {
      path: parsed.path,
      selector: parsed.selector,
    });
  }

  const scheme = parsePathScheme(value);

  if (scheme !== undefined)
    return LOCATOR_SCHEMES.has(scheme.scheme)
      ? { kind: 'scheme' }
      : { kind: 'invalid', message: UNKNOWN_SCHEME_MESSAGE };

  return value.startsWith('/')
    ? machineTarget(currentMachine(context), value)
    : relativeTarget(value, context);
}

/** A relative path resolved lexically from the Workspace root's Machine. */
function relativeTarget(
  value: string,
  context: LocatorContext,
): ResolvedLocator {
  const { workspaceRoot } = context;

  if (workspaceRoot === undefined)
    return { kind: 'invalid', message: NO_WORKSPACE_ROOT_MESSAGE };

  const bound = machineWorkspaceRoot(workspaceRoot);
  const name = bound?.name ?? currentMachine(context);

  const rootPath =
    bound?.path ?? (workspaceRoot.startsWith('/') ? workspaceRoot : undefined);

  if (rootPath === undefined)
    return { kind: 'invalid', message: NO_WORKSPACE_ROOT_MESSAGE };

  const split = splitReadSelector(value);
  const resolved = posix.resolve(rootPath, split.path);

  const trailing =
    split.path.endsWith('/') && resolved !== '/' ? `${resolved}/` : resolved;

  return machineTarget(name, trailing, {
    path: trailing,
    selector: split.selector,
  });
}

/**
 * One Machine address from a decoded path. The split the caller supplies is
 * the authority on what the locator names: a appended selector stays a
 * selector, and a path a locator already decoded keeps its literal colons.
 */
function machineTarget(
  name: string | undefined,
  value: string,
  split: ReadSplit = splitReadSelector(value),
): ResolvedLocator {
  if (name === undefined)
    return { kind: 'invalid', message: NO_CURRENT_MACHINE_MESSAGE };

  const locator = formatMachineLocator(name, split.path, split.selector);

  if (locator === undefined)
    return { kind: 'invalid', message: BAD_MACHINE_PATH_MESSAGE };

  return {
    kind: 'machine',
    name: name.toLowerCase(),
    path: split.path,
    locator,
    ...(split.selector !== undefined && { selector: split.selector }),
  };
}

/** A path and the read selector split off it, if the text held one. */
type ReadSplit = {
  readonly path: string;
  readonly selector?: string;
};

/** A path and the read selector a valid trailing suffix spells, if any. */
function splitReadSelector(value: string): ReadSplit {
  const split = splitSelectorSuffix(value);

  return split.selector !== undefined && isSelectorSuffix(split.selector)
    ? { path: split.path, selector: split.selector }
    : { path: value };
}

/** The literal path text of one Machine target: a read selector re-attached
 *  as the path text the tool takes literally. */
export function literalTargetPath(target: MachineTarget): string {
  return target.selector === undefined
    ? target.path
    : `${target.path}:${target.selector}`;
}

/**
 * The canonical locator for one absolute Machine path, with a trailing read
 * selector kept as a selector rather than encoded into the filename.
 */
function machineLocator(name: string, value: string): string | undefined {
  const split = splitReadSelector(value);

  return formatMachineLocator(name, split.path, split.selector);
}
