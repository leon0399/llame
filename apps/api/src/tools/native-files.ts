import { z } from 'zod';
import { createFile, editFile, readFile } from '@workspace/native-file-tools';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { type Tool, type ToolContext, type ToolResult } from './types';

type NativeCall =
  | { operation: 'read'; input: { path: string } }
  | {
      operation: 'edit';
      input: { path: string; oldText: string; newText: string };
    }
  | { operation: 'write'; input: { path: string; content: string } };

let nativeMutations: Promise<void> = Promise.resolve();

function executeNative(
  context: ToolContext,
  call: NativeCall,
): Promise<ToolResult> {
  if (call.operation === 'read') return executeNativeBound(context, call);
  const pending = nativeMutations.then(() => executeNativeBound(context, call));
  nativeMutations = pending.then(
    () => {},
    () => {},
  );
  return pending;
}

async function executeNativeBound(
  context: ToolContext,
  call: NativeCall,
): Promise<ToolResult> {
  const { runId, nativeExecutorId, toolCallId, userId } = context;
  if (!runId || !nativeExecutorId || !toolCallId)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    };
  context.abortSignal?.throwIfAborted();
  const prior = await context.tenantDb.runAs(userId, (db) =>
    new NativeFilesRepository(db).begin({
      runId,
      userId,
      executorId: nativeExecutorId,
      toolCallId,
      operation: call.operation,
      path: call.input.path,
    }),
  );
  if (prior) return prior;
  context.abortSignal?.throwIfAborted();
  const result = await performNative(call, context.abortSignal);
  if (call.operation !== 'read') {
    await context.tenantDb.runAs(userId, async (db) => {
      await new RunEventsRepository(db).append(runId, 'native.result', {
        toolCallId,
        result,
      });
    });
  }
  return result;
}

function performNative(
  call: NativeCall,
  signal?: AbortSignal,
): Promise<ToolResult> {
  switch (call.operation) {
    case 'read':
      return readFile(call.input);
    case 'edit':
      return editFile(call.input, signal);
    case 'write':
      return createFile(call.input, signal);
  }
}

const PATH_GUIDANCE =
  "Use an absolute path on this native host. This alpha tool has the host OS user's file authority. Output line-number prefixes are navigation metadata, never file bytes.";

export const nativeReadTool: Tool<{ path: string }> = {
  id: 'read',
  classification: 'read_only',
  description: `Read a local UTF-8 regular file. ${PATH_GUIDANCE} Select one-based lines with :N-M or :N+K. Normal reads include one live line on either side. :raw and :raw:N-M return verbatim source without prefixes or context. nextOffset is zero-based: resume at nextOffset + 1.`,
  inputSchema: z.object({ path: z.string().min(1) }).strict(),
  execute: (context, input) =>
    executeNative(context, { operation: 'read', input }),
};

export const nativeEditTool: Tool<{
  path: string;
  oldText: string;
  newText: string;
}> = {
  id: 'edit',
  classification: 'write_low_risk',
  description: `Replace one exact unique oldText occurrence with newText in a current local file. ${PATH_GUIDANCE} Use empty newText to delete. Missing or ambiguous oldText fails without changing the file.`,
  inputSchema: z
    .object({
      path: z.string().min(1),
      oldText: z.string().min(1),
      newText: z.string(),
    })
    .strict(),
  execute: (context, input) =>
    executeNative(context, { operation: 'edit', input }),
};

export const nativeWriteTool: Tool<{ path: string; content: string }> = {
  id: 'write',
  classification: 'write_low_risk',
  description: `Create a new local UTF-8 file. ${PATH_GUIDANCE} Existing targets fail with file_exists. Use edit for changes to existing files.`,
  inputSchema: z
    .object({ path: z.string().min(1), content: z.string() })
    .strict(),
  execute: (context, input) =>
    executeNative(context, { operation: 'write', input }),
};

export function isNativeFileTool(tool: Tool): boolean {
  return (
    tool === nativeReadTool ||
    tool === nativeEditTool ||
    tool === nativeWriteTool
  );
}
