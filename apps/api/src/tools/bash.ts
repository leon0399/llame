import { z } from 'zod';
import {
  admitManagedBash,
  type BashExecutorContext,
  type BashResult,
} from '@workspace/bash-executor';
import { type Tool, type ToolContext, type ToolResult } from './types';
import { isNativeFileTool } from './native-files';
import { bashWorkingDirectory } from './env';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';

type AdmittedBashExecution = Extract<
  ReturnType<typeof admitManagedBash>,
  { readonly run: () => Promise<BashResult> }
>;
type AdmittedBashContext = ToolContext &
  Required<Pick<ToolContext, 'runId' | 'nativeExecutorId' | 'toolCallId'>>;

function managedContext(): BashExecutorContext {
  const workingDirectory = bashWorkingDirectory();
  return {
    workingDirectory,
    fileToolsWorkingDirectory: workingDirectory,
    // ponytail: alpha host claims; managed Sandbox must prove these for stronger isolation.
    secretBoundary: true,
    processIsolation: true,
    outputBound: Number('32000'),
    inputBound: Number('8000'),
    durationMs: Number('300000'),
    maxProcesses: 1,
  };
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

export const bashTool: Tool<{
  command: string;
}> = {
  id: 'bash',
  classification: 'execute_code',
  description:
    'Run a shell command in the trusted working directory (invoked as `bash -c`). Alpha host authority — not tenant isolation. Prefer native edit for small exact replacements. Example: command="pwd && ls".',
  inputSchema: z.object({ command: z.string().min(1) }).strict(),
  execute: async (context, input): Promise<ToolResult> => {
    const { runId, userId, nativeExecutorId, toolCallId } = context;
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
      { command: 'bash', args: ['-c', input.command] },
      managedContext(),
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

/** Native files + alpha host bash admission. */
export function isHostCapabilityTool(tool: Tool): boolean {
  return isNativeFileTool(tool) || isBashTool(tool);
}
