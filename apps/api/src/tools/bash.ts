import { z } from 'zod';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { admitManagedBash, type BashResult } from '@workspace/bash-executor';
import { parsePathScheme } from '@workspace/native-file-tools';
import { type Tool, type ToolContext, type ToolResult } from './types';
import { isNativeFileTool } from './native-files';
import { isWorkspaceTool } from './workspace';
import { managedBashContext } from './bash-limits';
import { toToolResult } from './bash-result';
import { executeSshBash } from './ssh-bash';
import { isSshLocator } from '../ssh/ssh-locator';
import {
  isWorkspaceRelative,
  machineWorkspaceRoot,
  mapToWorkspaceHost,
  resolveWorkspacePath,
} from './workspace-path';
import {
  formatMachineLocator,
  isMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import {
  MACHINE_BASH_BUDGET_MS,
  machineBudgetMs,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineUnusableResult,
  readProcBashResult,
  runMachineMutation,
} from './machine-call';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';

type AdmittedBashExecution = Extract<
  ReturnType<typeof admitManagedBash>,
  { readonly run: () => Promise<BashResult> }
>;
type AdmittedBashContext = ToolContext &
  Required<Pick<ToolContext, 'runId' | 'nativeExecutorId' | 'toolCallId'>>;

type BashInput = {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
};

/** A working directory resolved to one Machine, and its canonical locator. */
type MachineWorkingDirectory = {
  readonly name: string;
  readonly path: string;
  readonly locator: string;
};

function machineWorkingDirectory(
  name: string,
  path: string,
): MachineWorkingDirectory | undefined {
  const locator = formatMachineLocator(name, path);
  return locator === undefined ? undefined : { name, path, locator };
}

/**
 * Resolve the working directory for this call. A Machine locator runs on that
 * Machine; inside a Machine Workspace an omitted or relative `cwd` resolves on
 * the Machine, and a bare absolute one is that Machine's absolute path. A
 * `file:` alias keeps addressing the local executor, so it is not a Machine
 * cwd.
 */
function projectBashInput(
  context: ToolContext,
  input: BashInput,
): BashInput | ToolResult {
  const root = context.workspaceRoot?.current();
  // An `ssh://` cwd addresses its own host in every Workspace, including a
  // Machine one, so projection leaves it exactly as submitted.
  if (input.cwd !== undefined && isSshLocator(input.cwd)) return input;
  if (input.cwd !== undefined && isMachineLocator(input.cwd))
    return projectMachineCwd(input, input.cwd);
  const machineRoot = machineWorkspaceRoot(root);
  if (machineRoot !== undefined && root !== undefined)
    return projectMachineWorkspaceCwd(input, root, machineRoot);
  return projectLocalCwd(input, root);
}

/** A submitted `machine://` cwd, canonicalized to the locator the call runs in. */
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

/**
 * A cwd inside a Machine Workspace: the root itself, a path relative to it, or
 * a bare absolute one, which addresses that Machine rather than the host.
 */
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

/** A cwd with no Machine in play: an absolute host path, or the Workspace root. */
function projectLocalCwd(
  input: BashInput,
  root: string | undefined,
): BashInput | ToolResult {
  if (
    root !== undefined &&
    input.cwd !== undefined &&
    parsePathScheme(input.cwd) !== undefined
  ) {
    return {
      status: 'error',
      type: 'invalid_path',
      message: 'The working directory must be a local path.',
    };
  }
  if (root === undefined) return input;
  if (input.cwd === undefined) return { ...input, cwd: root };
  if (!isWorkspaceRelative(input.cwd)) return input;
  return { ...input, cwd: resolveWorkspacePath(root, input.cwd) };
}

/**
 * Run on the Machine through its working directory: the command, the managed
 * base environment, the shared bounds, and cancellation all travel to the
 * daemon, and the durable attempt is the same unbound fence a Machine
 * mutation uses.
 */
async function runMachineBash(
  context: ToolContext,
  input: BashInput,
  machine: MachineWorkingDirectory,
): Promise<ToolResult> {
  const { name, path, locator } = machine;
  const connector = machineConnector(context);
  if (connector === undefined)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    };
  if (!connector.isConfigured(name)) return machineNotFoundResult(name);
  return runMachineMutation(
    context,
    { name, operation: 'bash', locator },
    async () => {
      const raw = await connector.request(
        name,
        'proc.bash',
        {
          envelope: machineCallEnvelope(
            context,
            machineBudgetMs(context, MACHINE_BASH_BUDGET_MS),
          ),
          command: input.command,
          cwd: path,
          ...(input.env !== undefined && { env: input.env }),
        },
        { signal: context.abortSignal },
      );
      const result = readProcBashResult(raw);
      return result === undefined
        ? machineUnusableResult(name)
        : toToolResult(result);
    },
  );
}

/**
 * The Machine branch of `bash`: a projected cwd that is a Machine locator runs
 * on that Machine, and `undefined` means this call has no Machine in it.
 */
function machineBashExecution(
  context: ToolContext,
  input: BashInput,
): ToolResult | Promise<ToolResult> | undefined {
  const cwd = input.cwd;
  if (cwd === undefined || !isMachineLocator(cwd)) return undefined;
  const target = parseMachineLocator(cwd);
  const machine =
    target.kind === 'path'
      ? machineWorkingDirectory(target.name, target.path)
      : undefined;
  if (machine === undefined)
    return {
      status: 'error',
      type: 'invalid_path',
      message: 'The working directory is not a Machine path.',
    };
  return runMachineBash(context, input, machine);
}

async function runAdmittedBash(
  context: AdmittedBashContext,
  admitted: AdmittedBashExecution,
): Promise<ToolResult> {
  const { runId, userId, nativeExecutorId, toolCallId } = context;
  const onAbort = () => admitted.release();
  if (context.abortSignal?.aborted) admitted.release();
  else context.abortSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    const prior = await context.tenantDb.runAs(userId, (db) =>
      new NativeFilesRepository(db).begin({
        runId,
        userId,
        fence: { bound: true, executorId: nativeExecutorId },
        deliverySequence: context.nativeDeliverySequence,
        toolCallId,
        operation: 'bash',
        path: admitted.cwd,
      }),
    );
    if (prior) return prior;
    const result = toToolResult(await admitted.run());
    await context.tenantDb.runAs(userId, async (db) => {
      await new RunEventsRepository(db).append(runId, 'native.result', {
        toolCallId,
        result,
      });
    });
    return result;
  } finally {
    context.abortSignal?.removeEventListener('abort', onAbort);
    admitted.release();
  }
}

export const bashTool: Tool<BashInput> = {
  id: 'bash',
  classification: 'execute_code',
  description: loadPackagedToolDescription('bash'),
  inputSchema: z.strictObject({
    command: z.string().min(1),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  execute: async (context, input): Promise<ToolResult> => {
    const { runId, userId, nativeExecutorId, toolCallId } = context;
    const projectedInput = projectBashInput(context, input);
    if ('status' in projectedInput) return projectedInput;
    const machineExecution = machineBashExecution(context, projectedInput);
    if (machineExecution !== undefined) return machineExecution;
    // An `ssh://` cwd runs before the local executor gate: it needs no local
    // executor, and a local cwd on the same process still refuses below.
    if (projectedInput.cwd !== undefined && isSshLocator(projectedInput.cwd))
      return executeSshBash(context, {
        ...projectedInput,
        cwd: projectedInput.cwd,
      });
    if (!runId || !nativeExecutorId || !toolCallId) {
      return {
        status: 'error',
        type: 'executor_unavailable',
        message: 'Native host authority is unavailable.',
      };
    }
    // Always wrap in bash -c: the managed allowlist only admits basenames like
    // `bash`, not `ls`/`cat`. Models pass ordinary shell text here.
    const admitted = admitManagedBash(
      {
        command: 'bash',
        args: ['-c', projectedInput.command],
        cwd: projectedInput.cwd,
        env: projectedInput.env,
      },
      managedBashContext(context),
      {
        signal: context.abortSignal,
        timeoutSignal: context.timeoutSignal,
        timeoutMs: context.timeoutMs,
        toolCallId,
      },
    );
    if ('type' in admitted) return toToolResult(admitted);
    return runAdmittedBash(
      { ...context, runId, userId, nativeExecutorId, toolCallId },
      admitted,
    );
  },
};

export function isBashTool(tool: Tool): boolean {
  return tool === bashTool;
}

/** Native files, alpha host bash, and Workspace binding tools. */
export function isHostCapabilityTool(tool: Tool): boolean {
  return isNativeFileTool(tool) || isBashTool(tool) || isWorkspaceTool(tool);
}
