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
import { machinePrefix } from '../machines/machine-locator';
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
import { NO_LOCAL_MACHINE_MESSAGE, verifyLocalMachine } from './local-machine';
import {
  bashTarget,
  type BashInput,
  type BashMachineTarget,
  type BashRoute,
} from './bash-target';
import { stopTool } from './stop';
import {
  hostCommand,
  runAsyncBash,
  runForegroundBash,
  type HostCommand,
} from './bash-async';

const bashLogger = new Logger('BashTool');

/** The daemon's own perf-stream bound, in code units (machine-protocol). */
const MACHINE_BASH_STREAM_BOUND: StreamBound = {
  kind: 'code-units',
  limit: BASH_BOUNDS.outputBound,
};

const REMOTE_BACKGROUND_REFUSAL =
  'async and unlimited are supported only for bash commands on the llame host.';

/**
 * Run on the Machine through its working directory: the command, the managed
 * base environment, the shared bounds, and cancellation all travel to the
 * daemon, and the durable attempt is the same unbound fence a Machine
 * mutation uses. No `cwd` means the daemon's own default directory.
 */
async function runMachineBash(
  context: ToolContext,
  input: BashInput,
  machine: BashMachineTarget,
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
    { name, operation: 'bash', locator: locator ?? machinePrefix(name) },
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
          ...(path !== undefined && { cwd: path }),
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
    const routed = bashTarget(context, input);

    if ('status' in routed) return routed;

    const refused = backgroundRefusal(routed, input);

    if (refused !== undefined) return refused;

    if (input.unlimited === true && context.allowUnlimitedJobs !== true)
      return {
        status: 'error',
        type: 'invalid_input',
        message:
          'tools.jobs.allowUnlimited is false; unlimited jobs are not allowed.',
      };

    if (routed.target === 'machine')
      return runMachineBash(context, routed.input, routed.machine);

    if (routed.target === 'ssh') return executeSshBash(context, routed.input);

    return runHostBash(context, routed);
  },
};

/**
 * `async` and `unlimited` need a process this worker owns. Another Machine
 * cannot promote its daemon's command to a local job, and an `ssh://` host has
 * no job runtime either; both refuse before any process starts. The Machine
 * refusal names that Machine and never this worker.
 */
function backgroundRefusal(
  routed: BashRoute,
  input: BashInput,
): ToolResult | undefined {
  if (input.async === undefined && input.unlimited === undefined)
    return undefined;

  if (routed.target === 'machine')
    return {
      status: 'error',
      type: 'invalid_input',
      message: `\`async\` is unavailable for Machine \`${routed.machine.name}\` on this attempt. Run the command synchronously.`,
    };

  return routed.target === 'ssh'
    ? {
        status: 'error',
        type: 'invalid_input',
        message: REMOTE_BACKGROUND_REFUSAL,
      }
    : undefined;
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

/**
 * The process's own Machine, served in process (design D8): the identity check
 * comes first, because the host runs tool code inside this process, then the
 * same managed bounds, fence, and job promotion a queued attempt uses.
 */
async function runHostBash(
  context: ToolContext,
  routed: Extract<BashRoute, { target: 'host' }>,
): Promise<ToolResult> {
  const { runId, localMachine, toolCallId, attemptId } = context;

  if (!runId || !localMachine || !toolCallId || !attemptId) {
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: NO_LOCAL_MACHINE_MESSAGE,
    };
  }

  const refusal = await verifyLocalMachine(context);

  if (refusal !== undefined) return refusal;

  // Repair the Chat's artifact files before this command can open them; a
  // failed reconcile leaves them as they were (tool-result-artifacts D10).
  if (context.artifactHostFiles === true) {
    await reconcileArtifactFiles(context).catch((error: unknown) => {
      bashLogger.warn(`Artifact file reconcile failed: ${String(error)}`);
    });
  }

  const admitted = admitHostCall(context, routed, toolCallId);

  if ('status' in admitted) return admitted;

  const fenced = {
    ...context,
    runId,
    localMachine,
    toolCallId,
    attemptId,
  };

  return routed.input.async === true
    ? runAsyncBash(fenced, admitted.command)
    : runForegroundBash(fenced, admitted.command);
}

/** One host call once its managed admission is settled. */
type AdmittedHostCall = {
  readonly command: HostCommand;
};

/**
 * The admission a host call takes before any executor runs: its slot first, so
 * a refused call records no attempt and starts no process (background-jobs
 * D7), then its managed bounds. The attempt records the canonical locator;
 * only the executor sees the absolute directory it enters.
 */
function admitHostCall(
  context: ToolContext,
  routed: Extract<BashRoute, { target: 'host' }>,
  toolCallId: string,
): ToolResult | AdmittedHostCall {
  const slot = acquireBashSlot(context);

  if ('status' in slot) return slot;

  const admitted = admitHostCommand(context, routed.input, toolCallId);

  if ('type' in admitted) {
    slot.release();

    return toToolResult(admitted);
  }

  return {
    command: hostCommand(
      routed.input,
      admitted.cwd,
      slot,
      routed.machine.locator ?? admitted.cwd,
    ),
  };
}

export function isBashTool(tool: Tool): boolean {
  return tool === bashTool;
}

/** Native files, alpha host bash, `stop`, and Workspace binding tools. */
export function isHostCapabilityTool(tool: Tool): boolean {
  return (
    isNativeFileTool(tool) ||
    isBashTool(tool) ||
    tool === stopTool ||
    isWorkspaceTool(tool)
  );
}
