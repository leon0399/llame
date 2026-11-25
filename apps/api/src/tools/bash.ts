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

/**
 * The daemon owns process execution on both host and configured Machines.
 */
async function runDaemonBash(
  context: ToolContext,
  routed: Extract<BashRoute, { target: 'host' | 'machine' }>,
): Promise<ToolResult> {
  if (context.bashJobs === undefined)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Machine job authority is unavailable.',
    };

  return context.bashJobs.run(context, routed.machine, routed.input);
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

export const bashTool: Tool<BashInput> = {
  id: 'bash',
  classification: 'execute_code',
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

    if (routed.target === 'ssh') return executeSshBash(context, routed.input);

    return runDaemonBash(context, routed);
  },
};

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
