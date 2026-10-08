import { posix } from 'node:path';

import { isRecord, isString } from '@workspace/runtime-safety';

import {
  importTargets,
  isLocalImportTarget,
  MAX_IMPORT_HOPS,
} from '../import-markers/import-markers';
import { decodeRelativePath } from '../tools/locator-spelling';
import { type PermissionDecision } from '../tools/permissions/types';
import { runTool } from '../tools/runner';
import { type Tool, type ToolContext, type ToolResult } from '../tools/types';
import {
  formatSkillLocator,
  SKILL_MAX_PATH_BYTES,
  SKILL_MAX_PATH_COMPONENTS,
} from './skill-locator';

/** Imports from an activated package, in depth-first order. */
export type SkillImport = {
  readonly path: string;
  readonly body: string;
  readonly truncationNotice?: string;
};

export type SkillActivationReadInput = {
  readonly path: string;
};

/**
 * Audit callbacks shared by activation's root read and package-local imports.
 * Admission is awaited before the read is dispatched, while completion records
 * the result that actually came back.
 */
export type SkillActivationActivity = {
  readonly admitted: (
    toolCallId: string,
    input: SkillActivationReadInput,
    decision: PermissionDecision,
  ) => void | Promise<void>;
  readonly completed: (
    toolCallId: string,
    result: ToolResult,
  ) => void | Promise<void>;
};

type SkillImportExpansionInput = {
  readonly skill: string;
  readonly runId: string;
  readonly mentionOrdinal: number;
  readonly body: string;
  readonly selection: ReadonlySet<string>;
  readonly toolContext: ToolContext;
  readonly readTool: Tool;
  readonly callTimeoutSeconds: number;
  readonly deadline: number;
  readonly activity: SkillActivationActivity;
  readonly canAccept: (imports: ReadonlyArray<SkillImport>) => boolean;
};

type ImportState = SkillImportExpansionInput & {
  readonly imports: Array<SkillImport>;
  readonly omitted: Array<string>;
  readonly seen: Set<string>;
  readOrdinal: number;
  exhausted: boolean;
};

type ResolvedImport = {
  readonly relativePath: string;
  readonly locator: string;
};

type ImportRead = {
  readonly file: SkillImport;
  readonly relativePath: string;
};

type SkillImportExpansion = {
  readonly imports: ReadonlyArray<SkillImport>;
  readonly omitted: ReadonlyArray<string>;
};

/** Expand local markers without changing the body that carries those markers. */
export async function expandSkillImports(
  input: SkillImportExpansionInput,
): Promise<SkillImportExpansion> {
  const state: ImportState = {
    ...input,
    imports: [],
    omitted: [],
    seen: new Set(['SKILL.md']),
    readOrdinal: 0,
    exhausted: false,
  };
  await expandBody(state, 'SKILL.md', input.body, 0);
  return { imports: state.imports, omitted: state.omitted };
}

/**
 * One audited read shared by activation's root SKILL.md and imported files.
 * The input passed to admission is the exact locator sent to the tool.
 */
export async function readSkillActivationFile(input: {
  readonly readTool: Tool;
  readonly toolContext: ToolContext;
  readonly selection: ReadonlySet<string>;
  readonly remainingMs: number;
  readonly callTimeoutSeconds: number;
  readonly toolCallId: string;
  readonly readInput: SkillActivationReadInput;
  readonly activity: SkillActivationActivity;
}): Promise<ToolResult> {
  const result = await runTool(
    input.readTool,
    input.readInput,
    {
      ...readContext(input.toolContext, input.selection, input.remainingMs),
      toolCallId: input.toolCallId,
    },
    input.callTimeoutSeconds,
    (decision) =>
      input.activity.admitted(input.toolCallId, input.readInput, decision),
  );
  await input.activity.completed(input.toolCallId, result);
  return result;
}

async function expandBody(
  state: ImportState,
  importer: string,
  body: string,
  hop: number,
): Promise<void> {
  if (hop >= MAX_IMPORT_HOPS) return;
  for (const target of importTargets(body)) {
    // A cancelled Run stops expanding: no further read is dispatched, so no
    // admission or completion event is recorded after the abort. The Run's
    // own cancellation handles the rest; nothing here is reported as omitted.
    if (state.toolContext.abortSignal?.aborted === true) return;
    const resolved = resolveImport(state.skill, importer, target);
    if (resolved === undefined || state.seen.has(resolved.relativePath))
      continue;
    state.seen.add(resolved.relativePath);
    if (state.exhausted || Date.now() >= state.deadline) {
      omitImport(state, resolved.locator);
      continue;
    }
    if (
      !state.canAccept([...state.imports, { path: resolved.locator, body: '' }])
    ) {
      omitImport(state, resolved.locator);
      continue;
    }
    const loaded = await readImport(state, resolved);
    if (loaded === undefined) continue;
    const candidate = [...state.imports, loaded.file];
    if (!state.canAccept(candidate)) {
      omitImport(state, resolved.locator);
      continue;
    }
    state.imports.push(loaded.file);
    await expandBody(state, loaded.relativePath, loaded.file.body, hop + 1);
  }
}

function omitImport(state: ImportState, locator: string): void {
  state.exhausted = true;
  state.omitted.push(locator);
}

function isBudgetAbort(result: ToolResult, deadline: number): boolean {
  return (
    result.status === 'error' &&
    (result.type === 'cancelled' ||
      result.type === 'timeout' ||
      result.type === 'timed_out') &&
    Date.now() >= deadline
  );
}

function resolveImport(
  skill: string,
  importer: string,
  target: string,
): ResolvedImport | undefined {
  if (!isLocalImportTarget(target) || posix.isAbsolute(target))
    return undefined;
  const decodedTarget = decodeRelativePath(target);
  if (decodedTarget === undefined) return undefined;
  const relativePath = posix.normalize(
    posix.join(posix.dirname(importer), decodedTarget),
  );
  const components = relativePath.split('/');
  if (
    relativePath === '.' ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    Buffer.byteLength(relativePath, 'utf8') > SKILL_MAX_PATH_BYTES ||
    components.length > SKILL_MAX_PATH_COMPONENTS
  ) {
    return undefined;
  }
  return {
    relativePath,
    locator: formatSkillLocator({ name: skill, relativePath }),
  };
}

async function readImport(
  state: ImportState,
  resolved: ResolvedImport,
): Promise<ImportRead | undefined> {
  const remainingMs = state.deadline - Date.now();
  if (remainingMs <= 0) {
    omitImport(state, resolved.locator);
    return undefined;
  }
  // Positional within ONE attempt, not stable across attempts: the event log
  // is append-only and system-origin rows are not reconciled by call id, so a
  // retried attempt that expands a different set of imports simply appends its
  // own ids rather than matching or replacing an earlier attempt's.
  const toolCallId = `skill-activation-${state.runId}-${state.mentionOrdinal}-${state.readOrdinal++}`;
  const readInput = { path: `${resolved.locator}:raw` };
  const result = await readSkillActivationFile({
    readTool: state.readTool,
    toolContext: state.toolContext,
    selection: state.selection,
    remainingMs,
    callTimeoutSeconds: state.callTimeoutSeconds,
    toolCallId,
    readInput,
    activity: state.activity,
  });
  if (isBudgetAbort(result, state.deadline)) {
    omitImport(state, resolved.locator);
    return undefined;
  }
  const output = readImportOutput(result);
  if (output === undefined) return undefined;
  return {
    relativePath: resolved.relativePath,
    file: {
      path: resolved.locator,
      body: output.content,
      ...(output.truncationNotice !== undefined && {
        truncationNotice: output.truncationNotice,
      }),
    },
  };
}

function readContext(
  toolContext: ToolContext,
  selection: ReadonlySet<string>,
  remainingMs: number,
): ToolContext {
  const budgetSignal = AbortSignal.timeout(remainingMs);
  return {
    ...toolContext,
    skillSelection: selection,
    abortSignal: toolContext.abortSignal
      ? AbortSignal.any([toolContext.abortSignal, budgetSignal])
      : budgetSignal,
  };
}

function readImportOutput(
  result: ToolResult,
):
  | { readonly content: string; readonly truncationNotice?: string }
  | undefined {
  if (result.status !== 'success' || !isRecord(result)) return undefined;
  if (result['kind'] !== 'file') return undefined;
  const content: unknown = result['content'];
  const truncationNotice: unknown = result['truncationNotice'];
  if (!isString(content)) return undefined;
  return {
    content,
    ...(isString(truncationNotice) && { truncationNotice }),
  };
}
