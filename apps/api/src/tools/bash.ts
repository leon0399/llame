import { z } from 'zod';
import {
  executeManagedBash,
  type BashExecutorContext,
  type BashResult,
} from '@workspace/bash-executor';
import { type Tool, type ToolResult } from './types';
import { isNativeFileTool } from './native-files';
import { bashWorkingDirectory } from './env';

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

function toToolResult(result: BashResult): ToolResult {
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

export const bashTool: Tool<{
  command: string;
}> = {
  id: 'bash',
  classification: 'execute_code',
  description:
    'Run a shell command in the trusted working directory (invoked as `bash -c`). Alpha host authority — not tenant isolation. Prefer native edit for small exact replacements. Example: command="pwd && ls".',
  inputSchema: z.object({ command: z.string().min(1) }).strict(),
  execute: async (context, input): Promise<ToolResult> => {
    if (!context.nativeExecutorId) {
      return {
        status: 'error',
        type: 'executor_unavailable',
        message: 'Native host authority is unavailable.',
      };
    }
    // Always wrap in bash -c: the managed allowlist only admits basenames like
    // `bash`, not `ls`/`cat`. Models pass ordinary shell text here.
    return toToolResult(
      await executeManagedBash(
        { command: 'bash', args: ['-c', input.command] },
        managedContext(),
        {
          signal: context.abortSignal,
          toolCallId: context.toolCallId,
        },
      ),
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
