import { z } from 'zod';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import {
  admitManagedBash,
  type BashExecutorContext,
  type BashResult,
} from '@workspace/bash-executor';
import { parsePathScheme } from '@workspace/native-file-tools';
import { type Tool, type ToolContext, type ToolResult } from './types';
import { isNativeFileTool } from './native-files';
import { isWorkspaceTool } from './workspace';
import { bashWorkingDirectory } from './env';
import { isWorkspaceRelative, resolveWorkspacePath } from './workspace-path';
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

function managedContext(context: ToolContext): BashExecutorContext {
  const workingDirectory =
    context.workspaceRoot?.current() ?? bashWorkingDirectory();
  return {
    workingDirectory,
    // ponytail: alpha host claims; managed Sandbox must prove these for stronger isolation.
    secretBoundary: true,
    processIsolation: true,
    outputBound: Number('32000'),
    inputBound: Number('8000'),
    durationMs: Number('300000'),
    maxProcesses: 1,
  };
}

function projectBashInput(
  context: ToolContext,
  input: BashInput,
): BashInput | ToolResult {
  const root = context.workspaceRoot?.current();
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

export function toToolResult(result: BashResult): ToolResult {
  if (result.status === 'success') {
    return {
      status: 'success',
      operation: result.operation,
      executor: result.executor,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
    };
  }
  if ('type' in result) {
    if (result.type === 'timed_out') {
      return {
        status: 'error',
        type: 'timed_out',
        message: `Command exceeded its deadline of ${result.durationMs} ms.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}${result.truncated ? '\nOutput was truncated.' : ''}`,
      };
    }
    return {
      status: 'error',
      type: result.type,
      message: result.message,
    };
  }
  return {
    status: 'error',
    type: 'command_failed',
    message: `Command exited with code ${result.exitCode}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  };
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
    if (!runId || !nativeExecutorId || !toolCallId) {
      return {
        status: 'error',
        type: 'executor_unavailable',
        message: 'Native host authority is unavailable.',
      };
    }
    const projectedInput = projectBashInput(context, input);
    if ('status' in projectedInput) return projectedInput;
    // Always wrap in bash -c: the managed allowlist only admits basenames like
    // `bash`, not `ls`/`cat`. Models pass ordinary shell text here.
    const admitted = admitManagedBash(
      {
        command: 'bash',
        args: ['-c', projectedInput.command],
        cwd: projectedInput.cwd,
        env: projectedInput.env,
      },
      managedContext(context),
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
