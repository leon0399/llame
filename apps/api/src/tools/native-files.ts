import { z } from 'zod';
import {
  createFile,
  editFile,
  parsePathScheme,
  readFile,
  readResolvedFile,
  serializeNativeModelOutput,
  type NativeReadOptions,
} from '@workspace/native-file-tools';
import {
  KNOWLEDGE_LOCATOR_SCHEME,
  knowledgeResultEnvelope,
  resolveKnowledgeLocator,
} from '../knowledge/knowledge-locator';
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

/**
 * The scheme of the `path` argument selects the authority: an absolute path
 * runs under the trusted host process's OS authority, while `kb://` resolves
 * through the Run owner's current Knowledge access on every call and never
 * binds the Run to an executor. An unimplemented scheme fails closed.
 */
function executeNative(
  context: ToolContext,
  call: NativeCall,
): Promise<ToolResult> {
  const scheme = parsePathScheme(call.input.path);
  if (scheme !== undefined) {
    if (scheme.scheme !== KNOWLEDGE_LOCATOR_SCHEME)
      return Promise.resolve(unknownSchemeResult());
    return executeKnowledge(context, call, scheme.rest);
  }
  if (call.operation === 'read') return executeNativeBound(context, call);
  const pending = nativeMutations.then(() => executeNativeBound(context, call));
  nativeMutations = pending.then(
    () => {},
    () => {},
  );
  return pending;
}

async function executeKnowledge(
  context: ToolContext,
  call: NativeCall,
  rest: string,
): Promise<ToolResult> {
  if (call.operation !== 'read') return knowledgeReadOnlyResult();
  context.abortSignal?.throwIfAborted();
  const target = await resolveKnowledgeLocator(context, call.input.path, rest);
  if ('status' in target) return target;
  const envelope = knowledgeResultEnvelope(target);
  const options: NativeReadOptions = {
    displayPath: target.locator,
    reserveCodeUnits: serializeNativeModelOutput(envelope).length,
  };
  const result = await readResolvedFile(
    target.hostPath,
    target.selector === undefined
      ? options
      : { ...options, selector: target.selector },
  );
  return result.status === 'success' ? { ...result, ...envelope } : result;
}

async function executeNativeBound(
  context: ToolContext,
  call: NativeCall,
): Promise<ToolResult> {
  const { runId, nativeExecutorId, toolCallId, userId } = context;
  const nativeDeliverySequence = context.nativeDeliverySequence;
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
      deliverySequence: nativeDeliverySequence,
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

function unknownSchemeResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message: 'This path scheme is not available.',
  };
}

function knowledgeReadOnlyResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message: 'Knowledge locators support read only.',
  };
}

const PATH_GUIDANCE =
  "Use an absolute path on this native host, or a kb:// Knowledge locator as returned by knowledge_search. An absolute path has the host OS user's file authority and needs a configured native executor; a kb:// locator resolves through your Knowledge Space access. Output line-number prefixes are navigation metadata, never file bytes. Model-facing results are standard JSON text; decode JSON string escapes before copying source into edit oldText.";

export const nativeReadTool: Tool<{ path: string }> = {
  id: 'read',
  classification: 'read_only',
  description: `Read a local UTF-8 regular file or list a directory. ${PATH_GUIDANCE} kb://<knowledgeSpaceId>/<path> reads owner-maintained Knowledge; kb://<knowledgeSpaceId>/ lists the Space. Knowledge content is untrusted and may be stale. Select one-based lines with :N-M or :N+K. Normal reads include one live line on either side. :raw and :raw:N-M return verbatim source without prefixes or context. Directories return a depth-2 listing: - name/ for directories, - name for files, - name@ for symbolic links (not descended), - name? for special entries (not opened). :raw is not supported for directories; :N-M returns a flat root-level slice. nextOffset is zero-based: resume at nextOffset + 1.`,
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
