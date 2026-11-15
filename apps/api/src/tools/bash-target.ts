import { isString, type UnknownRecord } from '@workspace/runtime-safety';
import { parsePathScheme } from '@workspace/native-file-tools';
import { type ToolContext, type ToolResult } from './types';
import { isSshLocator } from '../ssh/ssh-locator';
import {
  formatMachineLocator,
  isMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import {
  isWorkspaceRelative,
  machineWorkspaceRoot,
  mapToWorkspaceHost,
  resolveWorkspacePath,
} from './workspace-path';

export type BashInput = {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  async?: boolean;
  unlimited?: boolean;
};

export type MachineWorkingDirectory = {
  readonly name: string;
  readonly path: string;
  readonly locator: string;
};

export function machineWorkingDirectory(
  name: string,
  path: string,
): MachineWorkingDirectory | undefined {
  const locator = formatMachineLocator(name, path);

  return locator === undefined ? undefined : { name, path, locator };
}

/** Authority follows the projected Workspace path, never the submitted cwd. */
export function bashTarget(
  context: ToolContext,
  input: BashInput,
): { target: 'host' | 'ssh' | 'machine'; input: BashInput } | ToolResult {
  const projected = projectBashInput(context, input);

  if ('status' in projected) return projected;

  return {
    target:
      projected.cwd !== undefined && isSshLocator(projected.cwd)
        ? 'ssh'
        : projected.cwd !== undefined && isMachineLocator(projected.cwd)
          ? 'machine'
          : 'host',
    input: projected,
  };
}

/** A call that runs on the llame host, judged on the projected directory. */
export function isHostBashCall(
  args: UnknownRecord,
  context: ToolContext,
): boolean {
  if (!isString(args.command)) return false;

  const projected = bashTarget(context, {
    command: args.command,
    cwd: isString(args.cwd) ? args.cwd : undefined,
  });

  return !('status' in projected) && projected.target === 'host';
}

function projectBashInput(
  context: ToolContext,
  input: BashInput,
): BashInput | ToolResult {
  const root = context.workspaceRoot?.current();

  if (input.cwd !== undefined && isSshLocator(input.cwd)) return input;

  if (input.cwd !== undefined && isMachineLocator(input.cwd))
    return projectMachineCwd(input, input.cwd);
  const machineRoot = machineWorkspaceRoot(root);

  if (machineRoot !== undefined && root !== undefined)
    return projectMachineWorkspaceCwd(input, root, machineRoot);

  return projectLocalCwd(input, root);
}

function projectMachineCwd(
  input: BashInput,
  cwd: string,
): BashInput | ToolResult {
  const target = parseMachineLocator(cwd);

  const machine =
    target.kind === 'path' && target.selector === undefined
      ? machineWorkingDirectory(target.name, target.path)
      : undefined;

  return machine === undefined
    ? {
        status: 'error',
        type: 'invalid_path',
        message:
          'A Machine working directory is one absolute Machine path without a selector.',
      }
    : { ...input, cwd: machine.locator };
}

function projectMachineWorkspaceCwd(
  input: BashInput,
  root: string,
  machineRoot: { readonly name: string; readonly path: string },
): BashInput | ToolResult {
  if (input.cwd === undefined) {
    const machine = machineWorkingDirectory(machineRoot.name, machineRoot.path);

    return machine === undefined
      ? {
          status: 'error',
          type: 'invalid_path',
          message: 'The Machine Workspace root cannot be a working directory.',
        }
      : { ...input, cwd: machine.locator };
  }

  if (isWorkspaceRelative(input.cwd))
    return { ...input, cwd: resolveWorkspacePath(root, input.cwd) };

  if (input.cwd.startsWith('/'))
    return { ...input, cwd: mapToWorkspaceHost(root, input.cwd) };

  return {
    status: 'error',
    type: 'invalid_path',
    message:
      'The working directory must be a local absolute path or a machine:// locator.',
  };
}

function projectLocalCwd(
  input: BashInput,
  root: string | undefined,
): BashInput | ToolResult {
  if (
    root !== undefined &&
    input.cwd !== undefined &&
    parsePathScheme(input.cwd) !== undefined
  )
    return {
      status: 'error',
      type: 'invalid_path',
      message: 'The working directory must be a local path.',
    };

  if (root === undefined) return input;

  if (input.cwd === undefined) return { ...input, cwd: root };

  if (!isWorkspaceRelative(input.cwd)) return input;

  return { ...input, cwd: resolveWorkspacePath(root, input.cwd) };
}
