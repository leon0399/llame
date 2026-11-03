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
 * The full model rendering as one artifact part. `undefined` means the Run has
 * no reader, so nothing is promised; a failed write — including a part over
 * `tools.artifacts.maxBytes`, which the writer refuses before allocating a
 * number — is `not-stored`. The allocated locator is checked against the
 * `read` group again, because the probe before the write cannot know the
 * counter value; a denied locator is not advertised, and its already-written
 * row stays an orphan the store has no delete for.
 */
async function storeHeadRendering(
  context: ToolContext,
  toolName: string,
  rendering: SpillRendering,
): Promise<CappedResultSpill | undefined> {
  const { runId } = context;
  if (runId === undefined || !canReadArtifacts(context, toolName)) {
    return undefined;
  }
  const written = await writeHeadArtifact(context, {
    runId,
    toolName,
    rendering,
  });
  // A sequence-specific `read` rule is judged on the allocated locator; when
  // neither path admits it, the row stays an orphan and nothing is promised. A
  // host route needs the file it would name; without one only `read` reaches it.
  const reachable =
    written.hostDirectory === undefined
      ? readAdmitsArtifact(context, toolName, written.seq)
      : canReadArtifacts(context, toolName, written.seq);
  if (!reachable) return { kind: 'not-stored' };
  const hostFiles = headHostFiles(context, toolName, written);
  return {
    kind: 'stored',
    locator: written.locator,
    lineCount: written.lineCount,
    // Absent host files read as no clause, so the field needs no guard.
    hostFiles,
  };
}

/** Store the whole rendering as the artifact's only part, host files included. */
function writeHeadArtifact(
  context: ToolContext,
  input: {
    readonly runId: string;
    readonly toolName: string;
    readonly rendering: SpillRendering;
  },
): Promise<WrittenArtifact> {
  return writeToolArtifact(
    context.tenantDb,
    {
      chatId: context.chatId,
      userId: context.userId,
      runId: input.runId,
      toolCallId: context.toolCallId ?? input.toolName,
      toolName: input.toolName,
      complete: true,
      parts: [
        {
          contentType: input.rendering.contentType,
          content: Buffer.from(input.rendering.content, 'utf8'),
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
function headHostFiles(
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
