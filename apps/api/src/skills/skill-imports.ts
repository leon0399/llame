import { posix } from 'node:path';

import { splitSelectorSuffix } from '@workspace/native-file-tools';
import { isRecord, isString } from '@workspace/runtime-safety';

import {
  decodeRelativePath,
  encodeRelativePath,
} from '../tools/locator-spelling';

import { importTargets } from '../import-markers/import-markers';
import { type PermissionDecision } from '../tools/permissions/types';
import { runTool } from '../tools/runner';
import { type Tool, type ToolContext, type ToolResult } from '../tools/types';

/** Imports from an activated package, in depth-first order. */
export type SkillImport = {
  readonly path: string;
  readonly body: string;
  readonly truncationNotice?: string;
};

export const MAX_SKILL_IMPORT_HOPS = 5;

const IMPORT_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

type ResolvedImport = {
  readonly relativePath: string;
  readonly locator: string;
};

type ImportRead = {
  readonly file: SkillImport;
  readonly relativePath: string;
};

type ImportState = {
  readonly skill: string;
  readonly runId: string;
  readonly mentionOrdinal: number;
  readonly selection: ReadonlySet<string>;
  readonly toolContext: ToolContext;
  readonly readTool: Tool;
  readonly callTimeoutSeconds: number;
  readonly deadline: number;
  readonly activity: SkillImportActivity;
  readonly imports: Array<SkillImport>;
  readonly omitted: Array<string>;
  readonly seen: Set<string>;
  readonly canAccept: (imports: ReadonlyArray<SkillImport>) => boolean;
  readOrdinal: number;
  exhausted: boolean;
};

export type SkillImportActivity = {
  readonly admitted: (
    toolCallId: string,
    decision: PermissionDecision,
  ) => void | Promise<void>;
  readonly completed: (
    toolCallId: string,
    result: ToolResult,
  ) => void | Promise<void>;
};

export type SkillImportExpansionInput = {
  readonly skill: string;
  readonly runId: string;
  readonly mentionOrdinal: number;
  readonly body: string;
  readonly selection: ReadonlySet<string>;
  readonly toolContext: ToolContext;
  readonly readTool: Tool;
  readonly callTimeoutSeconds: number;
  readonly deadline: number;
  readonly activity: SkillImportActivity;
  readonly canAccept: (imports: ReadonlyArray<SkillImport>) => boolean;
};

export type SkillImportExpansion = {
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

async function expandBody(
  state: ImportState,
  importer: string,
  body: string,
  hop: number,
): Promise<void> {
  if (hop >= MAX_SKILL_IMPORT_HOPS) return;
  for (const target of importTargets(body)) {
    const resolved = resolveImport(state.skill, importer, target);
    if (resolved === undefined || state.seen.has(resolved.relativePath))
      continue;
    state.seen.add(resolved.relativePath);
    if (state.exhausted || Date.now() >= state.deadline) {
      state.exhausted = true;
      state.omitted.push(resolved.locator);
      continue;
    }
    if (
      !state.canAccept([...state.imports, { path: resolved.locator, body: '' }])
    ) {
      state.exhausted = true;
      state.omitted.push(resolved.locator);
      continue;
    }
    const loaded = await readImport(state, resolved);
    if (loaded === undefined) continue;
    const candidate = [...state.imports, loaded.file];
    if (!state.canAccept(candidate)) {
      state.exhausted = true;
      state.omitted.push(resolved.locator);
      continue;
    }
    state.imports.push(loaded.file);
    await expandBody(state, loaded.relativePath, loaded.file.body, hop + 1);
  }
}

function resolveImport(
  skill: string,
  importer: string,
  target: string,
): ResolvedImport | undefined {
  if (
    target.startsWith('~/') ||
    IMPORT_SCHEME.test(target) ||
    posix.isAbsolute(target) ||
    splitSelectorSuffix(target).selector !== undefined
  ) {
    return undefined;
  }
  const decodedTarget = decodeRelativePath(target);
  if (decodedTarget === undefined) return undefined;
  const relativePath = posix.normalize(
    posix.join(posix.dirname(importer), decodedTarget),
  );
  if (
    relativePath === '.' ||
    relativePath === '..' ||
    relativePath.startsWith('../')
  ) {
    return undefined;
  }
  return {
    relativePath,
    locator: `skill://${skill}/${encodeRelativePath(relativePath)}`,
  };
}

async function readImport(
  state: ImportState,
  resolved: ResolvedImport,
): Promise<ImportRead | undefined> {
  const remainingMs = state.deadline - Date.now();
  if (remainingMs <= 0) return undefined;
  const toolCallId = `skill-activation-${state.runId}-${state.mentionOrdinal}-${state.readOrdinal++}`;
  const result = await runTool(
    state.readTool,
    { path: `${resolved.locator}:raw` },
    {
      ...readContext(state.toolContext, state.selection, remainingMs),
      toolCallId,
    },
    state.callTimeoutSeconds,
    (decision) => state.activity.admitted(toolCallId, decision),
  );
  await state.activity.completed(toolCallId, result);
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
