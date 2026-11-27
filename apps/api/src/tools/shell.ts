import { z } from 'zod';
import { executeSshBash } from './ssh-bash';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { type Tool, type ToolContext, type ToolResult } from './types';
import { isNativeFileTool } from './native-files';
import { isWorkspaceTool } from './workspace';
import { bashTarget, type BashInput, type BashRoute } from './bash-target';
import { stopTool } from './stop';

const REMOTE_BACKGROUND_REFUSAL =
  'async and unlimited are supported only for bash commands on the llame host.';

const REMOTE_SHELL_REFUSAL =
  'Only `bash` runs through an ssh:// cwd. Give a machine:// cwd, or run the command with `bash`.';

/**
 * The daemon owns process execution on both host and configured Machines.
 */
async function runDaemonBash(
  context: ToolContext,
  routed: Extract<BashRoute, { target: 'host' | 'machine' }>,
  shell: ShellId,
): Promise<ToolResult> {
  if (context.bashJobs === undefined)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Machine job authority is unavailable.',
    };

  return context.bashJobs.run(context, routed.machine, routed.input, shell);
}

function backgroundRefusal(
  routed: BashRoute,
  input: BashInput,
): ToolResult | undefined {
  if (input.async === undefined && input.unlimited === undefined)
    return undefined;

  if (routed.target !== 'ssh') return undefined;

  return {
    status: 'error',
    type: 'invalid_input',
    message: REMOTE_BACKGROUND_REFUSAL,
  };
}

/** The shells the model can name as a tool, each running as its own dialect. */
export const SHELL_TOOL_IDS = ['bash', 'zsh'] as const;

export type ShellId = (typeof SHELL_TOOL_IDS)[number];

export function createShellTool(id: ShellId): Tool<BashInput> {
  return {
    id,
    classification: 'execute_code',
    spill: 'tool',
    description: loadPackagedToolDescription(id),
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

      if (routed.target === 'ssh')
        return id === 'bash'
          ? executeSshBash(context, routed.input)
          : {
              status: 'error',
              type: 'invalid_input',
              message: REMOTE_SHELL_REFUSAL,
            };

      return runDaemonBash(context, routed, id);
    },
  };
}

/** Whether a tool runs shell text, whichever dialect it names. */
export function isShellTool(tool: Tool): boolean {
  return isShellId(tool.id);
}

/** Whether a tool id names a shell dialect this harness runs. */
export function isShellId(toolId: string): toolId is ShellId {
  return SHELL_TOOL_IDS.some((id) => id === toolId);
}

/** Native files, the shell tools, `stop`, and Workspace binding tools. */
export function isHostCapabilityTool(tool: Tool): boolean {
  return (
    isNativeFileTool(tool) ||
    isShellTool(tool) ||
    tool === stopTool ||
    isWorkspaceTool(tool)
  );
}
