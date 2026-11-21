import { resolve as resolvePath } from 'node:path';

import { isString, type UnknownRecord } from '@workspace/runtime-safety';
import { type ToolContext, type ToolResult } from './types';
import { isSshLocator } from '../ssh/ssh-locator';
import {
  formatMachineLocator,
  isMachineLocator,
} from '../machines/machine-locator';
import { bashWorkingDirectory } from './env';
import {
  currentMachine,
  NO_CURRENT_MACHINE_MESSAGE,
  resolveMachinePath,
  type LocatorContext,
} from './workspace-path';

export type BashInput = {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  async?: boolean;
  unlimited?: boolean;
};

/**
 * The trusted locator facts of one call (design D6): the entered Workspace
 * root, `machines.default`, and `machines.local`, never a model argument.
 */
export function locatorContextOf(
  context: Pick<
    ToolContext,
    'workspaceRoot' | 'defaultMachine' | 'localMachine'
  >,
): LocatorContext {
  return {
    workspaceRoot: context.workspaceRoot?.current(),
    defaultMachine: context.defaultMachine,
    localMachine: context.localMachine,
  };
}

/** The Machine a `bash` call runs on, and the directory it runs in. */
export type BashMachineTarget = {
  /** Lowercase Machine name. */
  readonly name: string;
  /**
   * Absolute path on the Machine. Absent only for another Machine with no
   * entered Workspace and no `cwd`: its daemon picks its own default directory.
   */
  readonly path?: string;
  /** The canonical locator of `path`; absent with it. */
  readonly locator?: string;
  /** `name === machines.local`: this process serves it in process at `path`. */
  readonly local: boolean;
};

/**
 * One call's destination: the transport class, its input, and its Machine.
 * `host` is the process's own Machine, served in process (design D8); `ssh`
 * has no Machine at all.
 */
export type BashRoute =
  | {
      readonly target: 'host';
      readonly input: BashInput;
      readonly machine: BashMachineTarget;
    }
  | {
      readonly target: 'machine';
      readonly input: BashInput;
      readonly machine: BashMachineTarget;
    }
  | {
      readonly target: 'ssh';
      readonly input: BashInput & { readonly cwd: string };
    };

const MACHINE_CWD_MESSAGE =
  'A Machine working directory is one absolute Machine path without a selector.';

const LOCAL_CWD_MESSAGE = 'The working directory must be a local path.';

/**
 * Where one call runs: an `ssh://` cwd keeps its own transport, every other
 * cwd resolves by the one locator rule, and the Machine that results decides
 * between this process and a daemon (design D8). Authority follows the
 * projected directory, never the submitted spelling.
 */
export function bashTarget(
  context: ToolContext,
  input: BashInput,
): BashRoute | ToolResult {
  const facts = locatorContextOf(context);

  if (input.cwd !== undefined && isSshLocator(input.cwd))
    return { target: 'ssh', input: { ...input, cwd: input.cwd } };

  const machine = machineTarget(facts, input);

  if ('status' in machine) return machine;

  return {
    target: machine.local ? 'host' : 'machine',
    input: projectedInput(input, machine),
    machine,
  };
}

/** A call that runs on the Machine of this process, judged on its directory. */
export function isHostBashCall(
  args: UnknownRecord,
  context: ToolContext,
): boolean {
  if (!isString(args.command)) return false;

  const routed = bashTarget(context, {
    command: args.command,
    cwd: isString(args.cwd) ? args.cwd : undefined,
  });

  return !('status' in routed) && routed.target === 'host';
}

/**
 * The Machine and directory of the call: the submitted `cwd`, else the
 * entered Workspace root, else the current Machine's default directory.
 */
function machineTarget(
  facts: LocatorContext,
  input: BashInput,
): BashMachineTarget | ToolResult {
  const value = input.cwd ?? facts.workspaceRoot;

  if (value === undefined) return defaultDirectory(facts);

  const resolved = resolveMachinePath(value, facts);

  if (resolved.kind === 'machine') {
    if (resolved.selector !== undefined)
      return invalidWorkingDirectory(MACHINE_CWD_MESSAGE);

    return {
      name: resolved.name,
      path: resolved.path,
      locator: resolved.locator,
      local: resolved.local,
    };
  }

  if (resolved.kind === 'invalid')
    return invalidWorkingDirectory(resolved.message);

  // A listing Machine locator names no directory, and every other scheme is
  // not a working directory at all.
  return invalidWorkingDirectory(
    isMachineLocator(value) ? MACHINE_CWD_MESSAGE : LOCAL_CWD_MESSAGE,
  );
}

/**
 * No Workspace and no `cwd`: the current Machine's own default directory. This
 * process knows its own; another Machine's daemon picks its first root, so no
 * path travels.
 */
function defaultDirectory(
  facts: LocatorContext,
): BashMachineTarget | ToolResult {
  const name = currentMachine(facts);

  if (name === undefined)
    return invalidWorkingDirectory(NO_CURRENT_MACHINE_MESSAGE);

  if (!isLocalName(name, facts.localMachine))
    return { name: name.toLowerCase(), local: false };

  const path = resolvePath(bashWorkingDirectory());
  const locator = formatMachineLocator(name, path);

  return {
    name: name.toLowerCase(),
    path,
    ...(locator !== undefined && { locator }),
    local: true,
  };
}

/** Whether a Machine name is the one this process hosts. */
function isLocalName(name: string, localMachine: string | undefined): boolean {
  return (
    localMachine !== undefined &&
    name.toLowerCase() === localMachine.toLowerCase()
  );
}

/**
 * An in-process command takes the absolute host path, so the executor and its
 * admission see a directory; a Machine command takes the canonical locator, so
 * nothing downstream reads the directory as a host path.
 */
function projectedInput(
  input: BashInput,
  machine: BashMachineTarget,
): BashInput {
  if (machine.path === undefined) return input;

  const cwd =
    machine.local || machine.locator === undefined
      ? machine.path
      : machine.locator;

  return { ...input, cwd };
}

function invalidWorkingDirectory(message: string): ToolResult {
  return { status: 'error', type: 'invalid_path', message };
}
