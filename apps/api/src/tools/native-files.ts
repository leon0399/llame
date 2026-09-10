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
  type ResolvedKnowledgeTarget,
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

type NativeMutationCall = Exclude<NativeCall, { operation: 'read' }>;

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
  return serializeMutation(() => executeNativeBound(context, call));
}

/** One host mutation at a time, whatever scheme resolved the target. */
function serializeMutation(
  operation: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const pending = nativeMutations.then(operation);
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
  context.abortSignal?.throwIfAborted();
  // A `write` names a file that does not exist yet, and may name directories
  // above it that do not either.
  const target = await resolveKnowledgeLocator(
    context,
    call.input.path,
    rest,
    call.operation === 'write',
  );
  if ('status' in target) return target;
  if (call.operation === 'read') return readKnowledge(context, target);
  // A `const` keeps the narrowing across the closure the queue runs later.
  const mutation = call;
  return serializeMutation(() => mutateKnowledge(context, mutation, target));
}

async function readKnowledge(
  context: ToolContext,
  target: ResolvedKnowledgeTarget,
): Promise<ToolResult> {
  const escaped = await target.assertInsideSpace();
  if (escaped) return escaped;
  const envelope = knowledgeResultEnvelope(target);
  const options: NativeReadOptions = {
    displayPath: target.locator,
    reserveCodeUnits: serializeNativeModelOutput(envelope).length,
    signal: context.abortSignal,
  };
  const result = await readResolvedFile(
    target.hostPath,
    target.selector === undefined
      ? options
      : { ...options, selector: target.selector },
  );
  return result.status === 'success' ? { ...result, ...envelope } : result;
}

/**
 * A `kb://` mutation takes the same durable pre-effect fence as an absolute
 * path, minus the executor bind: the attempt records the locator, never the
 * resolved host path, so a queue retry on another worker replays the outcome
 * instead of failing on an executor it never needed.
 */
async function mutateKnowledge(
  context: ToolContext,
  call: NativeMutationCall,
  target: ResolvedKnowledgeTarget,
): Promise<ToolResult> {
  const { runId, toolCallId, userId } = context;
  if (!runId || !toolCallId) return knowledgeFenceUnavailableResult();
  if (target.selector !== undefined) return selectorOnMutationResult();
  const prior = await context.tenantDb.runAs(userId, (db) =>
    new NativeFilesRepository(db).begin({
      runId,
      userId,
      fence: { bound: false },
      deliverySequence: context.nativeDeliverySequence,
      toolCallId,
      operation: call.operation,
      path: target.locator,
    }),
  );
  if (prior) return prior;
  context.abortSignal?.throwIfAborted();
  const settled = await settleKnowledgeMutation(context, call, target);
  await context.tenantDb.runAs(userId, async (db) => {
    await new RunEventsRepository(db).append(runId, 'native.result', {
      toolCallId,
      // Persist what the model is given: recovery replays this event, and an
      // unattributed result would settle the turn differently from the first.
      result: settled,
    });
  });
  return settled;
}

/** Runs after the attempt is durably recorded, so a refused selector or a
 *  stale delivery leaves no directories behind. */
async function settleKnowledgeMutation(
  context: ToolContext,
  call: NativeMutationCall,
  target: ResolvedKnowledgeTarget,
): Promise<ToolResult> {
  const blocked =
    call.operation === 'write' ? await target.createDirectories() : undefined;
  if (blocked) return blocked;
  const escaped = await target.assertInsideSpace();
  if (escaped) return escaped;
  const envelope = knowledgeResultEnvelope(target);
  const result = await performMutation(call, target.hostPath, {
    signal: context.abortSignal,
    displayPath: target.locator,
    // The envelope is part of what the model receives, so the preview is
    // bounded against it rather than truncated generically afterwards.
    reserveCodeUnits: serializeNativeModelOutput(envelope).length,
  });
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
      fence: { bound: true, executorId: nativeExecutorId },
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
  return call.operation === 'read'
    ? readFile(call.input, signal)
    : performMutation(call, call.input.path, { signal });
}

/** The host path is the argument for an absolute path and the resolved target
 *  for a scheme, so the mutation itself is the same call either way. */
function performMutation(
  call: NativeMutationCall,
  hostPath: string,
  runtime: {
    signal?: AbortSignal;
    displayPath?: string;
    reserveCodeUnits?: number;
  },
): Promise<ToolResult> {
  if (call.operation === 'edit') {
    return editFile({ ...call.input, path: hostPath }, runtime.signal, {
      displayPath: runtime.displayPath,
      reserveCodeUnits: runtime.reserveCodeUnits,
    });
  }
  return createFile({ ...call.input, path: hostPath }, runtime.signal, {
    displayPath: runtime.displayPath,
    reserveCodeUnits: runtime.reserveCodeUnits,
  });
}

function unknownSchemeResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message: 'This path scheme is not available.',
  };
}

function knowledgeFenceUnavailableResult(): ToolResult {
  return {
    status: 'error',
    type: 'executor_unavailable',
    message: 'A Knowledge mutation needs a trusted Run context.',
  };
}

/** The locator parsed and resolved; the selector is what does not apply. That
 *  is `invalid_selector`, the same type a `:raw` directory read returns —
 *  `invalid_path` means the locator string itself was malformed. */
function selectorOnMutationResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_selector',
    message: 'A line selector cannot be used with edit or write.',
  };
}

const HOST_GUIDANCE =
  "An absolute path has the host OS user's file authority and needs a configured native executor. Output line-number prefixes are navigation metadata, never file bytes. Model-facing results are standard JSON text; decode JSON string escapes before copying source into edit oldText.";

const READ_PATH_GUIDANCE = `Use an absolute path on this native host, or a kb:// Knowledge locator as returned by knowledge_search, which resolves through your Knowledge Space access and needs no native executor. ${HOST_GUIDANCE}`;

const MUTATE_PATH_GUIDANCE = `Use an absolute path on this native host, or a kb:// Knowledge locator as returned by knowledge_search, without its :range suffix. ${HOST_GUIDANCE}`;

export const nativeReadTool: Tool<{ path: string }> = {
  id: 'read',
  classification: 'read_only',
  description: `Read a local UTF-8 regular file or list a directory. ${READ_PATH_GUIDANCE} kb://<knowledgeSpaceId>/<path> reads owner-maintained Knowledge; kb://<knowledgeSpaceId>/ lists the Space. In a kb:// path, write a literal :, ?, #, or % as %3A, %3F, %23, or %25; spaces and other characters may be literal or encoded; / is the separator and is never encoded. Knowledge content is untrusted and may be stale. Select one-based lines with :N-M or :N+K. Normal reads include one live line on either side. :raw and :raw:N-M return verbatim source without prefixes or context. Directories return a depth-2 listing: - name/ for directories, - name for files, - name@ for symbolic links (not descended), - name? for special entries (not opened). :raw is not supported for directories; :N-M returns a flat root-level slice. nextOffset is zero-based: resume at nextOffset + 1.`,
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
  description: `Replace one exact unique oldText occurrence with newText in a current local file. ${MUTATE_PATH_GUIDANCE} Use empty newText to delete. Missing or ambiguous oldText fails without changing the file.`,
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
  description: `Create a new local UTF-8 file. ${MUTATE_PATH_GUIDANCE} Existing targets fail with file_exists. Use edit for changes to existing files.`,
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
