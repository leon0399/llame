import { z } from 'zod';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import {
  parsePathScheme,
  readResolvedFile,
  REPLACE_TARGET_MISSING_MESSAGE,
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
import { resolveMachinePath } from './workspace-path';
import { executeWebRead } from './web-read/execute';
import { executeMediaRead } from './media-read';
import { readAttributionReserve } from './model-text';
import { MEDIA_LOCATOR_SCHEME } from '../media/media-locator';
import {
  executeMachineNative,
  performMutation,
  rewriteNativeCallPath,
  serializeNativeMutation,
} from './machine-files';
import {
  formatMachineLocator,
  isMachineLocator,
  MACHINE_SCHEME,
  parseMachineLocator,
} from '../machines/machine-locator';
import { executeSshNative } from './ssh-files';
import { SSH_SCHEME } from '../ssh/ssh-locator';
import { readArtifact } from './artifacts/artifact-reader';
import { ARTIFACT_SCHEME } from './artifacts/locator';
import { JOB_SCHEME } from '../jobs/job-locator';
import { readJob } from '../jobs/job-reader';
import { PROJECT_SCHEME } from '../projects/project-locator';
import { readProjectResource } from '../projects/project-reader';
import { placeListingSelector } from './listing-window';

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

/**
 * The `path` argument selects the authority (design D6). A bare or `file:`
 * path resolves on the current Machine; a relative path resolves from the
 * entered Workspace root; `machine://<name>/<path>` names its own Machine.
 * Every Machine target — this process's own Machine included — runs on that
 * Machine through `MachineConnector` (design D8), and every reported path is a
 * canonical locator. Every other locator scheme keeps its own reader: `kb://`
 * resolves through the Run owner's current Knowledge access on every call,
 * `http://`/`https://` use the API process's own outbound HTTP, `media://`,
 * `projects://`, `skill://`, `artifact://`, `job://`, and `ssh://` keep their
 * existing routing, and none of them binds a worker. An unimplemented scheme
 * fails closed.
 */
function executeNative(
  context: ToolContext,
  call: NativeCall,
): Promise<ToolResult> {
  const target = resolveMachinePath(call.input.path, {
    workspaceRoot: context.workspaceRoot?.current(),
    defaultMachine: context.defaultMachine,
    localMachine: context.localMachine,
  });

  if (target.kind === 'invalid')
    return Promise.resolve({
      status: 'error',
      type: 'invalid_path',
      message: target.message,
    });

  if (target.kind === 'machine')
    return executeMachineNative(
      context,
      rewriteNativeCallPath(call, target.locator),
      call.input.path,
    );

  const scheme = parsePathScheme(call.input.path);

  if (scheme === undefined) return Promise.resolve(unknownSchemeResult());
  const reader = LOCATOR_READERS.get(scheme.scheme);

  return reader === undefined
    ? Promise.resolve(unknownSchemeResult())
    : reader(context, call, scheme.rest);
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
    [ARTIFACT_SCHEME]: (context, call) =>
      readArtifact(context, call.operation, call.input.path),
    [JOB_SCHEME]: (context, call) =>
      readJob(context, call.operation, call.input.path),
    // The reader re-parses the submitted locator, which policy admitted in its
    // canonical form; it needs the whole text, selector included.
    [PROJECT_SCHEME]: (context, call) =>
      readProjectResource(context, call.operation, call.input.path),
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

  return serializeNativeMutation(() =>
    mutateKnowledge(context, mutation, target),
  );
}

/**
 * Skill locators are read-only. The catalog resolves the current winning
 * package on every call, so a removed or newly invalid package fails here
 * rather than serving stale bytes. Operator roots stay installation
 * resources, and the bound Workspace's own roots are Machine locators the
 * attempt's snapshot read from the Workspace's Machine.
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
  const placed = placeListingSelector(SKILL_CATALOG_LOCATOR, selector, count);

  if ('refusal' in placed) {
    return invalidCatalogSelectorResult(
      placed.refusal === 'invalid'
        ? 'The skill catalog selector is invalid.'
        : placed.refusal === 'outline'
          ? 'The :outline member is not supported for the skill catalog.'
          : 'The skill catalog accepts a single :N-M, :N+K, :N-, or :-K range; comma ranges and :raw are not supported.',
    );
  }

  return placed.window;
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
      attemptId: context.attemptId,
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
    // Edit and write still render as JSON here; the reads reserve text width.
    reserveCodeUnits: serializeNativeModelOutput(envelope).length,
  });

  return result.status === 'success' ? { ...result, ...envelope } : result;
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
  return [nativeReadTool, nativeEditTool, nativeWriteTool].includes(tool);
}
