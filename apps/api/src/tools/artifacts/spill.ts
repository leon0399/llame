/**
 * The generic `head` spill at the cap sites (tool-result-artifacts D3, D6).
 *
 * A result larger than the model-facing cap is stored whole first, then cut in
 * place, so the inline part keeps the shape the tool declared. The artifact is
 * written only when the Run can read it back: `read` with the `read` group
 * admitting the locator, or a host-bound `bash` that opens its host files
 * (design D10). A rendering larger than
 * `tools.artifacts.maxBytes` is not stored at all, because cutting JSON would
 * make it invalid; a failed write is the same outcome.
 */

import {
  isOversizedResult,
  RESULT_TRUNCATE_CHARS,
  truncateOversizedResult,
  type ArtifactNoticeHostFiles,
  type CappedResultSpill,
  type ToolResult,
} from '@workspace/runtime-safety';

import { BUILT_IN_DEFAULTS } from '../../instance-config/llame-config';
import {
  measureToolResultForModel,
  renderToolResultForSpill,
  type SpillRendering,
} from '../model-text';
import { type Tool, type ToolContext } from '../types';
import { machineWorkspaceRoot } from '../workspace-path';
import { writeToolArtifact, type WrittenArtifact } from './artifact-writer';
import { canReadArtifacts, readAdmitsArtifact } from './readable';

/** The operator bound, or the built-in one outside the run loop. */
export function artifactMaxBytes(context: ToolContext): number {
  return context.artifactMaxBytes ?? BUILT_IN_DEFAULTS.tools.artifacts.maxBytes;
}

/**
 * Apply a tool's spill declaration (D3). A `tool` result builds its own inline
 * part and artifact, so the cap must not shorten it; `head` (the default)
 * keeps the shape-preserving cut.
 */
export async function capToolResult(
  tool: Tool,
  context: ToolContext,
  result: ToolResult,
): Promise<ToolResult> {
  return tool.spill === 'tool'
    ? result
    : await capHeadResult(context, tool.id, result);
}

/**
 * Cap one `head` result: store the whole rendering when the Run can read it,
 * then keep the shape-preserving cut inline with a notice that names the
 * artifact. An unreadable Run keeps today's bounded result and no locator.
 */
export async function capHeadResult(
  context: ToolContext,
  toolName: string,
  result: ToolResult,
): Promise<ToolResult> {
  // A `head` result is a success cut in place; an error keeps its message and
  // never spills. A `tool` result owns its own error artifacts.
  if (result.status !== 'success') return result;
  const measure = measureToolResultForModel(toolName);
  const hasDisplay = Object.hasOwn(result, 'display');
  const rendered = hasDisplay
    ? undefined
    : renderToolResultForSpill(toolName, result);
  const oversized =
    rendered === undefined
      ? isOversizedResult(result, measure)
      : rendered.text.length > RESULT_TRUNCATE_CHARS;
  if (!oversized) return result;
  const rendering = rendered ?? renderToolResultForSpill(toolName, result);
  const spill = await boundedSpill(context, toolName, rendering);
  const spilled =
    spill?.kind === 'stored' ? { ...result, artifact: spill.locator } : result;
  return truncateOversizedResult(spilled, measure, spill);
}

/**
 * Store the rendering, bounded by the Run and call deadline. A database that
 * cannot answer leaves the inline result only; a write that lands after the
 * deadline is an artifact no result names.
 */
async function boundedSpill(
  context: ToolContext,
  toolName: string,
  rendering: SpillRendering,
): Promise<CappedResultSpill | undefined> {
  const signal = context.abortSignal;
  if (signal === undefined) {
    return await storeHeadRendering(context, toolName, rendering).catch(() => ({
      kind: 'not-stored',
    }));
  }
  if (signal.aborted) return { kind: 'not-stored' };
  return await new Promise<CappedResultSpill | undefined>((resolve) => {
    const onAbort = () => resolve({ kind: 'not-stored' });
    const settle = (spill: CappedResultSpill | undefined): void => {
      signal.removeEventListener('abort', onAbort);
      resolve(spill);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void storeHeadRendering(context, toolName, rendering).then(settle, () =>
      settle({ kind: 'not-stored' }),
    );
  });
}

/**
 * The full model rendering as one artifact part.
 * `undefined` means the Run has no reader, so nothing is promised; a failed
 * write — including a part over `tools.artifacts.maxBytes`, which the writer
 * refuses before allocating a number — is `not-stored`. The allocated locator
 * is checked against the `read` group again, because the probe before the
 * write cannot know the counter value; a denied locator is not advertised,
 * and its already-written row stays an orphan the store has no delete for.
 */
async function storeHeadRendering(
  context: ToolContext,
  toolName: string,
  rendering: SpillRendering,
): Promise<CappedResultSpill | undefined> {
  const write = await writeSinglePart(context, toolName, {
    contentType: rendering.contentType,
    content: rendering.content,
  });
  if (write.kind === 'no-reader') return undefined;
  // The head spill settles one outcome: a failed write rejects here, and
  // `boundedSpill` turns that rejection into `not-stored`.
  if (write.kind === 'failed') throw new Error('The artifact write failed.');
  const written = write.written;
  const hostFiles = artifactHostFiles(context, toolName, written);
  return {
    kind: 'stored',
    locator: written.locator,
    lineCount: written.lineCount,
    // Absent host files read as no clause, so the field needs no guard.
    hostFiles,
  };
}

/** One part a tool that builds its own artifact hands to the shared store. */
export type SinglePartArtifact = {
  readonly contentType: string;
  readonly content: string;
  /** The read-time re-check record (`grep` and `web_search` only). */
  readonly findings?: unknown;
  /** Whether the producer stored the whole result it found; default `true`. */
  readonly complete?: boolean;
};

/**
 * Store one part for a tool, or nothing. A Run without a reader gets nothing;
 * a failed write — the writer refuses a part over `tools.artifacts.maxBytes`
 * before allocating a number — is the same. The allocated locator is judged
 * again, because the probe before the write cannot know the counter value.
 */
export async function storeSinglePartArtifact(
  context: ToolContext,
  toolName: string,
  part: SinglePartArtifact,
): Promise<WrittenArtifact | undefined> {
  const write = await writeSinglePart(context, toolName, part);
  return write.kind === 'written' ? write.written : undefined;
}

/** The shared one-part write's outcome: no reader, a failure, or the row. */
type SinglePartWrite =
  | { readonly kind: 'no-reader' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'written'; readonly written: WrittenArtifact };

/** Write one part after probing the Run, then re-check the allocated locator. */
async function writeSinglePart(
  context: ToolContext,
  toolName: string,
  part: SinglePartArtifact,
): Promise<SinglePartWrite> {
  const { runId } = context;
  if (runId === undefined || !canReadArtifacts(context, toolName)) {
    return { kind: 'no-reader' };
  }
  try {
    const written = await writePart(context, runId, toolName, part);
    // A host route needs the file it would name: when the writer made none,
    // only `read` reaches the artifact.
    const reachable =
      written.hostDirectory === undefined
        ? readAdmitsArtifact(context, toolName, written.seq)
        : canReadArtifacts(context, toolName, written.seq);
    return reachable ? { kind: 'written', written } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** The writer request of one part, host files and the call's signals included. */
function writePart(
  context: ToolContext,
  runId: string,
  toolName: string,
  part: SinglePartArtifact,
): Promise<WrittenArtifact> {
  return writeToolArtifact(
    context.tenantDb,
    {
      chatId: context.chatId,
      userId: context.userId,
      runId,
      toolCallId: context.toolCallId ?? toolName,
      toolName,
      complete: part.complete ?? true,
      parts: [
        {
          contentType: part.contentType,
          content: Buffer.from(part.content, 'utf8'),
          findings: part.findings,
        },
      ],
    },
    {
      maxBytes: artifactMaxBytes(context),
      hostFiles: context.artifactHostFiles === true,
      abortSignal: context.abortSignal,
      timeoutSignal: context.timeoutSignal,
    },
  );
}

/**
 * The host-file facts of the cap notice, or undefined when no file was made.
 * A Machine Workspace cannot open a llame host path, so `elsewhere` holds
 * there; a head spill stores only when the Run can read it back, which is the
 * route the notice then names.
 */
export function artifactHostFiles(
  context: ToolContext,
  toolName: string,
  written: WrittenArtifact,
): ArtifactNoticeHostFiles | undefined {
  const directory = written.hostDirectory;
  if (directory === undefined) return undefined;
  return {
    directory,
    elsewhere:
      machineWorkspaceRoot(context.workspaceRoot?.current()) !== undefined,
    readable: readAdmitsArtifact(context, toolName, written.seq),
  };
}
