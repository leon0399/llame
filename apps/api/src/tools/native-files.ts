import { z } from 'zod';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import {
  applySelectorSuffix,
  createFile,
  editFile,
  parsePathScheme,
  readFile,
  readResolvedFile,
  replaceFile,
  REPLACE_TARGET_MISSING_MESSAGE,
  serializeNativeModelOutput,
  type NativeReadOptions,
  type ReadTarget,
} from '@workspace/native-file-tools';
import {
  KNOWLEDGE_LOCATOR_SCHEME,
  knowledgeResultEnvelope,
  resolveKnowledgeLocator,
  type ResolvedKnowledgeTarget,
} from '../knowledge/knowledge-locator';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  skillCatalogEnvelope,
  skillResultEnvelope,
} from '../skills/skill-results';
import { SKILL_LOCATOR_SCHEME } from '../skills/skill-locator';
import {
  NO_SKILL_SELECTION,
  isSkillCatalogResult,
  resolveSkillLocator,
} from '../skills/skill-target';
import { type Tool, type ToolContext, type ToolResult } from './types';

type NativeCall =
  | { operation: 'read'; input: { path: string } }
  | {
      operation: 'edit';
      input: { path: string; oldText: string; newText: string };
    }
  | {
      operation: 'write';
      input: { path: string; content: string; replace?: boolean };
    };

type NativeMutationCall = Exclude<NativeCall, { operation: 'read' }>;

/** Replace asserts its target exists; create mode may create one. The flag is
 *  absent or false for every create, so only an explicit `true` replaces. */
function replacing(call: NativeCall): boolean {
  return call.operation === 'write' && call.input.replace === true;
}

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
    if (scheme.scheme === KNOWLEDGE_LOCATOR_SCHEME) {
      return executeKnowledge(context, call, scheme.rest);
    }
    if (scheme.scheme === SKILL_LOCATOR_SCHEME) {
      return executeSkill(context, call, scheme.rest);
    }
    return Promise.resolve(unknownSchemeResult());
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
  // Reads reach the native miss handler for sibling suggestions; a create may
  // create a missing leaf or parent, while a replace asserts the leaf exists.
  // All still prove ancestor containment.
  const target = await resolveKnowledgeLocator(
    context,
    call.input.path,
    rest,
    call.operation !== 'edit' && !replacing(call),
  );
  if ('status' in target)
    return replacing(call) && target.type === 'not_found'
      ? { ...target, message: REPLACE_TARGET_MISSING_MESSAGE }
      : target;
  if (call.operation === 'read') return readKnowledge(context, target);
  // A `const` keeps the narrowing across the closure the queue runs later.
  const mutation = call;
  return serializeMutation(() => mutateKnowledge(context, mutation, target));
}

/**
 * Skill locators are read-only. The catalog resolves the current winning
 * package on every call, so a removed or newly invalid package fails here
 * rather than serving stale bytes, and no executor identity is needed: the
 * catalog reads the operator's own configured roots.
 */
async function executeSkill(
  context: ToolContext,
  call: NativeCall,
  rest: string,
): Promise<ToolResult> {
  if (call.operation !== 'read') return skillMutationUnsupportedResult();
  context.abortSignal?.throwIfAborted();
  const catalog = context.skillCatalog;
  if (catalog === undefined) return skillCatalogUnavailableResult();
  const resolved = await resolveSkillLocator(
    catalog,
    rest,
    context.skillSelection ?? NO_SKILL_SELECTION,
  );
  if ('status' in resolved) return resolved;
  if (isSkillCatalogResult(resolved)) {
    const window = catalogWindow(resolved.selector);
    if ('status' in window) return window;
    return skillCatalogEnvelope(resolved.entries, window);
  }
  const envelope = skillResultEnvelope(resolved);
  const options: NativeReadOptions = {
    displayPath: resolved.locator,
    reserveCodeUnits: serializeNativeModelOutput(envelope).length,
    signal: context.abortSignal,
  };
  const result = await readResolvedFile(
    resolved.hostPath,
    resolved.selector === undefined
      ? options
      : { ...options, selector: resolved.selector },
  );
  return result.status === 'success' ? { ...result, ...envelope } : result;
}

/**
 * The catalog listing pages with the native single-range selector, so it
 * accepts exactly the ranges a file read accepts — including the inclusive
 * `N-M` end and the `N+K` length — and rejects anything else. Anything the
 * grammar accepts but a listing cannot express (`:raw`, comma multi-range)
 * fails rather than silently answering with the first page. `N-` and `+`
 * operands are validated by the shared parser, so `:0-0` and `:5-2` fail.
 */
function catalogWindow(
  selector: string | undefined,
): { readonly offset: number; readonly limit?: number } | ToolResult {
  if (selector === undefined) return { offset: 0 };
  let target: ReadTarget;
  try {
    target = applySelectorSuffix(SKILL_CATALOG_LOCATOR, selector);
  } catch {
    return invalidCatalogSelectorResult(
      'The skill catalog selector is invalid.',
    );
  }
  if (target.raw || target.ranges !== undefined) {
    return invalidCatalogSelectorResult(
      'The skill catalog accepts a single :N-M or :N+K range; comma ranges and :raw are not supported.',
    );
  }
  return target.limit === undefined
    ? { offset: target.offset }
    : { offset: target.offset, limit: target.limit };
}

const SKILL_CATALOG_LOCATOR = 'skill://';

function invalidCatalogSelectorResult(message: string): ToolResult {
  return { status: 'error', type: 'invalid_selector', message };
}

function skillMutationUnsupportedResult(): ToolResult {
  return {
    status: 'error',
    type: 'unsupported_operation',
    message: 'Skill locators are read-only; edit and write cannot target them.',
  };
}

function skillCatalogUnavailableResult(): ToolResult {
  return {
    status: 'error',
    type: 'skill_catalog_unavailable',
    message: 'The skill catalog is unavailable.',
  };
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
 *  stale delivery leaves no directories behind. A replace never creates one:
 *  its target exists by precondition, and creating a missing parent would
 *  contradict the assertion that failed. */
async function settleKnowledgeMutation(
  context: ToolContext,
  call: NativeMutationCall,
  target: ResolvedKnowledgeTarget,
): Promise<ToolResult> {
  const blocked =
    call.operation === 'write' && !replacing(call)
      ? await target.createDirectories()
      : undefined;
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
  const input = { path: hostPath, content: call.input.content };
  const options = {
    displayPath: runtime.displayPath,
    reserveCodeUnits: runtime.reserveCodeUnits,
  };
  return replacing(call)
    ? replaceFile(input, runtime.signal, options)
    : createFile(input, runtime.signal, options);
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
export const nativeReadTool: Tool<{ path: string }> = {
  id: 'read',
  classification: 'read_only',
  description: loadPackagedToolDescription('read'),
  inputSchema: z.strictObject({ path: z.string().min(1) }),
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
  description: loadPackagedToolDescription('edit'),
  inputSchema: z.strictObject({
    path: z.string().min(1),
    oldText: z.string().min(1),
    newText: z.string(),
  }),
  execute: (context, input) =>
    executeNative(context, { operation: 'edit', input }),
};

export const nativeWriteTool: Tool<{
  path: string;
  content: string;
  replace?: boolean;
}> = {
  id: 'write',
  classification: 'write_low_risk',
  description: loadPackagedToolDescription('write'),
  inputSchema: z.strictObject({
    path: z.string().min(1),
    content: z.string(),
    replace: z.boolean().optional(),
  }),
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
