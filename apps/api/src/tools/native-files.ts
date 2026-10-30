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
  resolveEndRelativeSelector,
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
import { workspaceSkillSources } from '../skills/workspace-skill-sources';
import {
  NO_SKILL_SELECTION,
  isSkillCatalogResult,
  resolveSkillLocator,
  skillCatalogUnavailableResult,
  type ResolvedSkillTarget,
} from '../skills/skill-target';
import { type Tool, type ToolContext, type ToolResult } from './types';
import {
  isWorkspaceRelative,
  mapToWorkspaceHost,
  resolveWorkspacePath,
} from './workspace-path';
import { executeWebRead } from './web-read/execute';
import { isFileAlias, decodeFileAlias } from './permissions/file-alias';
import { executeMediaRead } from './media-read';
import { readAttributionReserve } from './model-text';
import { MEDIA_LOCATOR_SCHEME } from '../media/media-locator';
import { executeMachineNative } from './machine-files';
import {
  formatMachineLocator,
  isMachineLocator,
  MACHINE_SCHEME,
  parseMachineLocator,
} from '../machines/machine-locator';
import { executeSshNative } from './ssh-files';
import { SSH_SCHEME } from '../ssh/ssh-locator';

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
 * binds the Run to an executor. `http://` and `https://` are fetched by the
 * API process's own outbound HTTP and bind no executor either, and `media://`
 * reads the Run owner's stored media. `machine://` runs on an operator-
 * configured Machine and never binds the local executor. An unimplemented
 * scheme fails closed.
 */
function executeNative(
  context: ToolContext,
  call: NativeCall,
): Promise<ToolResult> {
  let hostCall: NativeCall;
  if (isFileAlias(call.input.path)) {
    const alias = decodeFileAlias(call.input.path);
    if (!alias.ok)
      return Promise.resolve({
        status: 'error' as const,
        type: 'invalid_path' as const,
        message: alias.message,
      });
    hostCall = rewritePath(call, alias.hostPath);
  } else {
    const scheme = parsePathScheme(call.input.path);
    if (scheme !== undefined) {
      const reader = LOCATOR_READERS.get(scheme.scheme);
      return reader === undefined
        ? Promise.resolve(unknownSchemeResult())
        : reader(context, call, scheme.rest);
    }
    hostCall = projectNativeCall(context, call);
    // A Machine Workspace maps relative and absolute paths to the Machine's
    // own locator, so they take the Machine branch like a written one.
    if (isMachineLocator(hostCall.input.path))
      return executeMachineNative(context, hostCall, call.input.path);
  }
  // A media placeholder names the path as submitted, not the host path.
  if (hostCall.operation === 'read')
    return executeNativeBound(context, hostCall, call.input.path);
  return serializeMutation(() =>
    executeNativeBound(context, hostCall, call.input.path),
  );
}

type LocatorReader = (
  context: ToolContext,
  call: NativeCall,
  rest: string,
) => Promise<ToolResult>;

/**
 * The locator schemes native file tools dispatch, keyed by the parsed,
 * lower-cased scheme. Consumers query {@link readAcceptsScheme} instead of
 * keeping their own scheme list, so a scheme added here reaches them too.
 */
const LOCATOR_READERS: ReadonlyMap<string, LocatorReader> = new Map(
  Object.entries({
    [MACHINE_SCHEME]: (context, call) =>
      executeMachineNative(context, call, call.input.path),
    [KNOWLEDGE_LOCATOR_SCHEME]: executeKnowledge,
    [SKILL_LOCATOR_SCHEME]: executeSkill,
    [MEDIA_LOCATOR_SCHEME]: ({ media, abortSignal }, call) =>
      media === undefined
        ? Promise.resolve(unknownSchemeResult())
        : executeMediaRead(media, call.operation, call.input.path, abortSignal),
    // The lower-cased scheme selects the branch; the branch re-parses the
    // submitted text, which policy matched, and requests its canonical form.
    http: (context, call) => executeWebRead(context, call),
    https: (context, call) => executeWebRead(context, call),
    [SSH_SCHEME]: (context, call) =>
      context.sshClient === undefined
        ? Promise.resolve(unknownSchemeResult())
        : executeSshNative(context, call.operation, call.input.path),
  } satisfies Record<string, LocatorReader>),
);

/** Whether native `read` dispatches this parsed, lower-cased scheme now. */
export function readAcceptsScheme(scheme: string): boolean {
  return LOCATOR_READERS.has(scheme);
}

/** Every parsed, lower-cased scheme native `read` dispatches now. */
export function readLocatorSchemes(): ReadonlyArray<string> {
  return [...LOCATOR_READERS.keys()];
}

function projectNativeCall(context: ToolContext, call: NativeCall): NativeCall {
  const root = context.workspaceRoot?.current();
  if (root === undefined) return call;
  if (isWorkspaceRelative(call.input.path))
    return rewritePath(call, resolveWorkspacePath(root, call.input.path));
  const mapped = mapToWorkspaceHost(root, call.input.path);
  return mapped === call.input.path ? call : rewritePath(call, mapped);
}

function rewritePath(call: NativeCall, path: string): NativeCall {
  if (call.operation === 'read') return { operation: 'read', input: { path } };
  if (call.operation === 'edit')
    return { operation: 'edit', input: { ...call.input, path } };
  return { operation: 'write', input: { ...call.input, path } };
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
 * catalog reads the operator roots plus the bound Chat's live Workspace roots.
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
  const root = context.workspaceRoot?.current();
  const extraSources =
    root === undefined ? undefined : workspaceSkillSources(root);
  const resolved = await resolveSkillLocator(
    catalog,
    rest,
    context.skillSelection ?? NO_SKILL_SELECTION,
    extraSources,
  );
  if ('status' in resolved) return resolved;
  if (isSkillCatalogResult(resolved)) {
    const window = catalogWindow(resolved.selector, resolved.entries.length);
    if ('status' in window) return window;
    return skillCatalogEnvelope(resolved.entries, window);
  }
  return readResolvedSkillTarget(context, resolved);
}

/**
 * The bytes of one resolved package file. A Machine Workspace's skill files
 * live on the Machine and are read there; every other target is read locally
 * under the ordinary host symbolic-link semantics. The skill envelope supplies
 * the package attribution either way.
 */
async function readResolvedSkillTarget(
  context: ToolContext,
  target: ResolvedSkillTarget,
): Promise<ToolResult> {
  const envelope = skillResultEnvelope(target);
  if (isMachineLocator(target.hostPath)) {
    const machineResult = await readMachineSkillFile(context, target);
    return machineResult.status === 'success'
      ? { ...machineResult, ...envelope }
      : machineResult;
  }
  const options: NativeReadOptions = {
    displayPath: target.locator,
    reserveCodeUnits: readAttributionReserve(envelope),
    followSymlinks: true,
    signal: context.abortSignal,
    media: context.media?.readMedia(target.locator, context.toolCallId),
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
 * A Machine Workspace's skill files live on the Machine, so the catalog
 * resolves them to Machine locators and this branch reads them there. The
 * read's reported path is a Machine locator; the skill envelope supplies the
 * package attribution as it does for a local package.
 */
function readMachineSkillFile(
  context: ToolContext,
  target: ResolvedSkillTarget,
): Promise<ToolResult> {
  const parsed = parseMachineLocator(target.hostPath);
  if (parsed.kind !== 'path')
    return Promise.resolve(skillCatalogUnavailableResult());
  const selector = target.selector ?? parsed.selector;
  const locator = formatMachineLocator(parsed.name, parsed.path, selector);
  if (locator === undefined)
    return Promise.resolve(skillCatalogUnavailableResult());
  return executeMachineNative(
    context,
    { operation: 'read', input: { path: locator } },
    locator,
  );
}

/**
 * The catalog listing pages with the native single-range selector, so it
 * accepts exactly the ranges a file read accepts — including the inclusive
 * `N-M` end, the `N+K` length, the open-ended `N-`, and the `-K` tail, which
 * the catalog's own entry count places the way a file's line count places it.
 * Anything the grammar accepts but a listing cannot express (`:raw`,
 * `:outline`, comma multi-range) fails rather than silently answering with the
 * first page. `N-` and `+` operands are validated by the shared parser, so
 * `:0-0` and `:5-2` fail.
 */
function catalogWindow(
  selector: string | undefined,
  count: number,
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
  if (target.outline) {
    return invalidCatalogSelectorResult(
      'The :outline member is not supported for the skill catalog.',
    );
  }
  if (
    target.raw ||
    target.ranges !== undefined ||
    target.pending?.includes(',') === true
  ) {
    return invalidCatalogSelectorResult(
      'The skill catalog accepts a single :N-M, :N+K, :N-, or :-K range; comma ranges and :raw are not supported.',
    );
  }
  return resolveEndRelativeSelector(target, count);
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

async function readKnowledge(
  context: ToolContext,
  target: ResolvedKnowledgeTarget,
): Promise<ToolResult> {
  const escaped = await target.assertInsideSpace();
  if (escaped) return escaped;
  const envelope = knowledgeResultEnvelope(target);
  const options: NativeReadOptions = {
    displayPath: target.locator,
    reserveCodeUnits: readAttributionReserve(envelope),
    // A Knowledge result exposes no resolved host path, so a link entry
    // renders without its target.
    linkTargets: false,
    signal: context.abortSignal,
    media: context.media?.readMedia(target.locator, context.toolCallId),
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
    reserveCodeUnits: readAttributionReserve(envelope),
  });
  return result.status === 'success' ? { ...result, ...envelope } : result;
}

/**
 * `submitted` is the path as the model wrote it, before a `file:` alias is
 * decoded or a Workspace-relative path projected; an image read is held in
 * the attempt's memory under it.
 */
async function executeNativeBound(
  context: ToolContext,
  call: NativeCall,
  submitted: string,
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
  const result = await performNative(call, context, submitted);
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
  context: ToolContext,
  submitted: string,
): Promise<ToolResult> {
  return call.operation === 'read'
    ? readFile(
        call.input,
        context.abortSignal,
        context.media?.readMedia(submitted, context.toolCallId),
      )
    : performMutation(call, call.input.path, { signal: context.abortSignal });
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
