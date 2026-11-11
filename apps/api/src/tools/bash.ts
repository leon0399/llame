import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { BASH_BOUNDS, type ProcBashResult } from '@workspace/machine-protocol';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import {
  admitManagedBash,
  sanitizeKnownResultAtBound,
  type AdmittedBashExecution,
  type BashTimedOutResult,
  type BashUnavailableResult,
  type StreamBound,
} from '@workspace/bash-executor';
import { type Tool, type ToolContext, type ToolResult } from './types';
import { isNativeFileTool } from './native-files';
import { isWorkspaceTool } from './workspace';
import { acquireBashSlot, managedBashContext } from './bash-limits';
import { toToolResult } from './bash-result';
import { reconcileArtifactFiles } from './artifacts/host-files';
import { spillBashResult } from './bash-spill';
import { executeSshBash } from './ssh-bash';
import { isSshLocator } from '../ssh/ssh-locator';
import {
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
import {
  bashTarget,
  machineWorkingDirectory,
  type BashInput,
  type MachineWorkingDirectory,
} from './bash-target';
import { runAsyncBash, runForegroundBash } from './bash-async';

const bashLogger = new Logger('BashTool');

/** The daemon's own perf-stream bound, in code units (machine-protocol). */
const MACHINE_BASH_STREAM_BOUND: StreamBound = {
  kind: 'code-units',
  limit: BASH_BOUNDS.outputBound,
};

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

      if (result === undefined) return machineUnusableResult(name);
      const sanitized = sanitizeMachineBashResult(context, result);

      // The Machine opens its own paths; the llame host files are a cache this
      // command cannot reach (tool-result-artifacts D10).
      return spillBashResult(context, sanitized, true);
    },
  );
}

/**
 * Redact the daemon's answer before it is spilled or recorded. Only a known
 * result carries streams; its capture has no lookahead, so a stream the
 * daemon's bound or deadline cut drops a trailing member prefix. A refusal or
 * an unknown outcome passes through unchanged.
 */
function sanitizeMachineBashResult(
  context: ToolContext,
  result: ProcBashResult,
): ProcBashResult {
  if (!('stdout' in result)) return result;

  const endedByLlame =
    result.truncated || ('type' in result && result.type === 'timed_out');

  return sanitizeKnownResultAtBound(
    result,
    MACHINE_BASH_STREAM_BOUND,
    context.configuredCredentials,
    {
      stdout: { endedByLlame },
      stderr: { endedByLlame },
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



export const bashTool: Tool<BashInput> = {
  id: 'bash',
  classification: 'execute_code',
  // Its own result already carries the bounded streams, the preview, and the
  // artifact notice, so the generic result cap must not shorten it again
  // (tool-result-artifacts D3).
  spill: 'tool',
  description: loadPackagedToolDescription('bash'),
  inputSchema: z.strictObject({
    command: z.string().min(1),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    async: z.boolean().optional(),
    unlimited: z.boolean().optional(),
  }),
  execute: async (context, input): Promise<ToolResult> => {
    const projected = bashTarget(context, input);

    if ('status' in projected) return projected;

    if (
      projected.target !== 'host' &&
      (input.async !== undefined || input.unlimited !== undefined)
    )
      return {
        status: 'error',
        type: 'invalid_input',
        message:
          'async and unlimited are supported only for bash commands on the llame host.',
      };

    if (input.unlimited === true && context.allowUnlimitedJobs !== true)
      return {
        status: 'error',
        type: 'invalid_input',
        message:
          'tools.jobs.allowUnlimited is false; unlimited jobs are not allowed.',
      };
    const routed = routedBashExecution(context, projected.input);

    return routed ?? runHostBash(context, projected.input);
  },
};

/**
 * A Machine cwd runs on that Machine, and an `ssh://` cwd runs before the
 * local executor gate: it needs no local executor, and a local cwd on the same
 * process still refuses below. `undefined` means the llame host.
 */
function routedBashExecution(
  context: ToolContext,
  input: BashInput,
): ToolResult | Promise<ToolResult> | undefined {
  const machineExecution = machineBashExecution(context, input);

  if (machineExecution !== undefined) return machineExecution;

  if (input.cwd === undefined || !isSshLocator(input.cwd)) return undefined;

  return executeSshBash(context, { ...input, cwd: input.cwd });
}

/**
 * Always wrap in bash -c: the managed allowlist only admits basenames like
 * `bash`, not `ls`/`cat`. Models pass ordinary shell text here.
 */
function admitHostCommand(
  context: ToolContext,
  input: BashInput,
  toolCallId: string,
): AdmittedBashExecution | BashUnavailableResult | BashTimedOutResult {
  return admitManagedBash(
    {
      command: 'bash',
      args: ['-c', input.command],
      cwd: input.cwd,
      env: input.env,
    },
    managedBashContext(context),
    {
      signal: context.abortSignal,
      toolCallId,
      protectedValues: context.configuredCredentials,
    },
  );
}

/** The llame host branch, fenced as a native attempt. */
async function runHostBash(
  context: ToolContext,
  input: BashInput,
): Promise<ToolResult> {
  const { runId, nativeExecutorId, toolCallId } = context;

  if (!runId || !nativeExecutorId || !toolCallId) {
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    };
  }

  // Repair the Chat's artifact files before this command can open them; a
  // failed reconcile leaves them as they were (tool-result-artifacts D10).
  if (context.artifactHostFiles === true) {
    await reconcileArtifactFiles(context).catch((error: unknown) => {
      bashLogger.warn(`Artifact file reconcile failed: ${String(error)}`);
    });
  }

  // The slot comes before the executor, so a refused call records no attempt
  // and starts no process (background-jobs D7).
  const slot = acquireBashSlot(context);

  if ('status' in slot) return slot;

  const admitted = admitHostCommand(context, input, toolCallId);

  if ('type' in admitted) {
    slot.release();

    return toToolResult(admitted);
  }

  if (input.async === true)
    return runAsyncBash(
      { ...context, runId, nativeExecutorId, toolCallId },
      input,
      admitted.cwd,
      slot,
    );

  return runForegroundBash(
    { ...context, runId, nativeExecutorId, toolCallId },
    input,
    admitted.cwd,
    slot,
  );
}

export function isBashTool(tool: Tool): boolean {
  return tool === bashTool;
}

/** Native files, alpha host bash, and Workspace binding tools. */
export function isHostCapabilityTool(tool: Tool): boolean {
  return isNativeFileTool(tool) || isBashTool(tool) || isWorkspaceTool(tool);
}
