/**
 * Content search over the locators this process can walk (grep-tool spec).
 *
 * The runner admits every scope once against the `grep` group; this module
 * compiles the patterns, resolves each scope into an engine `GrepScope` with
 * per-file `read` admission, and pages the engine's passages.
 */

import {
  compileGrepPatterns,
  decodeGrepCursor,
  GREP_LIMITS,
  hashGrepInputs,
  runGrepScan,
  type CompiledGrepPatterns,
  type DecodedGrepCursor,
  type GrepBudget,
  type GrepScanInput,
  type GrepScanResult,
} from '@workspace/native-file-tools';
import { z } from 'zod';

import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import {
  createGrepReadAdmission,
  grepScopeStrings,
  projectGrepScope,
  type GrepReadAdmission,
} from './grep-admission';
import { resolveScopes } from './grep-scopes';
import { type ResolvedScopes } from './grep-scope-shape';
import {
  GrepScopeFailure,
  invalidCursorResult,
  invalidInputResult,
  invalidPatternResult,
  type GrepToolError,
} from './grep-results';
import { type Tool, type ToolContext, type ToolResult } from './types';

export const grepInputSchema = z.strictObject({
  patterns: z.array(z.string().min(1).max(512)).min(1).max(8),
  scopes: z.array(z.string().min(1)).min(1).max(16).optional(),
  literal: z.boolean().optional(),
  ignoreCase: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  cursor: z.string().optional(),
});

type GrepArguments = z.infer<typeof grepInputSchema>;

export const nativeGrepTool: Tool<GrepArguments> = {
  id: 'grep',
  classification: 'read_only',
  description: loadPackagedToolDescription('grep'),
  inputSchema: grepInputSchema,
  execute: (context, input) => executeGrep(context, input),
};

/** Whether a registry entry is this tool, by identity. */
export function isGrepTool(tool: Tool): boolean {
  return tool === nativeGrepTool;
}

async function executeGrep(
  context: ToolContext,
  input: GrepArguments,
): Promise<ToolResult> {
  context.abortSignal?.throwIfAborted();
  const root = context.workspaceRoot?.current();
  const submitted = grepScopeStrings(input, root);
  if (submitted === undefined) return scopesRequiredResult(context);
  const patterns = compileSubmittedPatterns(input);
  if ('status' in patterns) return patterns;

  const admission = createGrepReadAdmission(context);
  try {
    const resolved = await resolveScopes(context, submitted, admission);
    if ('result' in resolved) return resolved.result;

    return await scanPassages({
      input,
      patterns,
      admission,
      resolved,
      projectedScopes: submitted.map(
        (scope) => projectGrepScope(scope, root).prefix,
      ),
    });
  } finally {
    // A scope refusal can have counted files too, so the audit sees them on
    // every exit after resolution began, not only on a completed page.
    admission.recordRefusals();
  }
}

type ScanRequest = {
  readonly input: GrepArguments;
  readonly patterns: CompiledGrepPatterns;
  readonly admission: GrepReadAdmission;
  readonly resolved: ResolvedScopes;
  readonly projectedScopes: ReadonlyArray<string>;
};

/** Page the engine over the resolved scopes; the caller records what hid. */
async function scanPassages(request: ScanRequest): Promise<ToolResult> {
  const { input, patterns, admission, resolved } = request;
  const inputHash = hashOf(input, request.projectedScopes, resolved.roots);
  const cursor = resolveCursor(input.cursor, inputHash);
  if ('result' in cursor) return cursor.result;

  const scanInput: GrepScanInput = {
    scopes: resolved.scopes,
    patterns,
    onCandidate: (locator) => Promise.resolve(admission.admit(locator)),
    budget: grepBudget(input.limit),
    inputHash,
    now: Date.now,
  };
  if (cursor.cursor !== undefined) scanInput.cursor = cursor.cursor;
  let scan: GrepScanResult;
  try {
    scan = await runGrepScan(scanInput);
  } catch (error) {
    if (error instanceof GrepScopeFailure) return error.result;
    throw error;
  }
  const result: ToolResult = {
    status: 'success',
    results: scan.results,
    complete: scan.complete,
    warnings: scan.warnings,
    ...(carriesKnowledgePassage(scan.results) && {
      notice: KNOWLEDGE_CONTENT_NOTICE,
    }),
  };
  return scan.cursor === undefined
    ? result
    : { ...result, cursor: scan.cursor };
}

/**
 * Whether the page holds a Knowledge passage. Knowledge content is untrusted
 * in the same way a `kb://` read is, so the whole page carries the closed
 * notice, exactly as `read` and `knowledge_search` do.
 */
function carriesKnowledgePassage(results: GrepScanResult['results']): boolean {
  return results.some((passage) =>
    passage.locator.startsWith(`${KNOWLEDGE_LOCATOR_SCHEME}://`),
  );
}

/** Compile the disjunction, or the refusal that names the offending index. */
function compileSubmittedPatterns(
  input: GrepArguments,
): CompiledGrepPatterns | GrepToolError {
  // Zod bounds the code units; the engine bound is UTF-8 bytes.
  const oversized = input.patterns.findIndex(
    (pattern) =>
      Buffer.byteLength(pattern, 'utf8') > GREP_LIMITS.maxPatternBytes,
  );
  if (oversized !== -1) {
    return invalidPatternResult(
      oversized,
      `pattern exceeds ${GREP_LIMITS.maxPatternBytes} UTF-8 bytes`,
    );
  }
  const compiled = compileGrepPatterns({
    patterns: input.patterns,
    literal: input.literal === true,
    ignoreCase: input.ignoreCase === true,
  });
  return compiled.ok
    ? compiled.compiled
    : invalidPatternResult(compiled.index, compiled.message);
}

type CursorOutcome =
  | { readonly cursor?: DecodedGrepCursor }
  | { readonly result: GrepToolError };

/** Decode the submitted cursor; only this call's own inputs can continue it. */
function resolveCursor(
  text: string | undefined,
  inputHash: string,
): CursorOutcome {
  if (text === undefined) return {};
  const decoded = decodeGrepCursor(text, inputHash);
  return 'error' in decoded
    ? { result: invalidCursorResult() }
    : { cursor: decoded };
}

function hashOf(
  input: GrepArguments,
  projectedScopes: ReadonlyArray<string>,
  resolvedRoots: ReadonlyArray<string>,
): string {
  return hashGrepInputs({
    patterns: input.patterns,
    literal: input.literal === true,
    ignoreCase: input.ignoreCase === true,
    projectedScopes,
    resolvedRoots,
  });
}

function grepBudget(limit: number | undefined): GrepBudget {
  return {
    files: GREP_LIMITS.filesExamined,
    entries: GREP_LIMITS.entriesListed,
    bytes: GREP_LIMITS.bytesRead,
    deadlineMs: GREP_LIMITS.deadlineMs,
    limit: limit ?? GREP_LIMITS.filesPerPage,
    pageUnits: GREP_LIMITS.pageCodeUnits,
  };
}

/**
 * The kinds this process can serve, and only those: no Space identifier, no
 * Machine name, and no host path may reach this message.
 */
function scopesRequiredResult(context: ToolContext): ToolResult {
  const kinds: Array<string> = [];
  if (context.nativeExecutorId !== undefined) kinds.push('host paths');
  if (context.machines !== undefined) kinds.push('machine:// locators');
  if (context.knowledgeResolver !== undefined) kinds.push('kb:// locators');
  if (context.skillCatalog !== undefined) kinds.push('skill:// locators');
  return invalidInputResult(
    kinds.length === 0
      ? 'grep requires scopes, and this process has no searchable backend.'
      : `grep requires scopes: this process can search ${joinKinds(kinds)}.`,
  );
}

function joinKinds(kinds: ReadonlyArray<string>): string {
  if (kinds.length === 1) return kinds[0];
  return `${kinds.slice(0, -1).join(', ')}, and ${kinds.at(-1)}`;
}
