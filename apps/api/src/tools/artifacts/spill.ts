/**
 * The generic `head` spill at the cap sites (tool-result-artifacts D3, D6).
 *
 * A result larger than the model-facing cap is stored whole first, then cut in
 * place, so the inline part keeps the shape the tool declared. The artifact is
 * written only when the Run can read it back: `read` in `tools.allowed` with
 * the `read` group admitting the locator, or `bash` on the llame host with host
 * files. A rendering larger than `tools.artifacts.maxBytes` is not stored at
 * all, because cutting JSON would make it invalid; a failed write is the same
 * outcome.
 */

import {
  isOversizedResult,
  truncateOversizedResult,
  type CappedResultSpill,
  type ToolResult,
} from '@workspace/runtime-safety';

import { DEFAULT_ARTIFACT_MAX_BYTES } from '../../instance-config/llame-config';
import {
  measureToolResultForModel,
  renderToolResultForModel,
} from '../model-text';
import { admitPermission } from '../permissions/admit';
import { nativeFileProjection } from '../permissions/locator-projection';
import { type Tool, type ToolContext } from '../types';
import { writeToolArtifact } from './artifact-writer';
import { formatArtifactLocator } from './locator';

/** One stored part as the writer takes it. */
type StoredPart = {
  readonly contentType: string;
  readonly content: Buffer;
};

/** The operator bound, or the built-in one outside the run loop. */
export function artifactMaxBytes(context: ToolContext): number {
  return context.artifactMaxBytes ?? DEFAULT_ARTIFACT_MAX_BYTES;
}

/**
 * Whether the Run can read back a `<toolName>` artifact. The `read` group is
 * evaluated on the artifact's canonical locator shape, because the counter
 * value is allocated by the write itself; a rule that names one sequence is
 * not predicted here. No compiled policy, or no allow, means no reader.
 */
export function runCanReadArtifacts(
  context: ToolContext,
  toolName: string,
): boolean {
  if (context.artifactHostFiles === true) return true;
  if (context.artifactReadable !== true) return false;
  const decision = admitPermission(context, (evaluate) =>
    evaluate({
      toolId: 'read',
      args: { path: formatArtifactLocator(toolName, 1) },
      projectFieldValue: nativeFileProjection('read'),
    }),
  );
  return decision?.decision === 'allow';
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
  const measure = measureToolResultForModel(toolName);
  if (!isOversizedResult(result, measure)) return result;
  const spill = await storeHeadRendering(context, toolName, result);
  const spilled =
    spill?.kind === 'stored' ? { ...result, artifact: spill.locator } : result;
  return truncateOversizedResult(spilled, measure, spill);
}

/**
 * The full model rendering as one artifact part. `undefined` means the Run has
 * no reader, so nothing is promised; a rendering over the bound, or a failed
 * write, is `not-stored`.
 */
async function storeHeadRendering(
  context: ToolContext,
  toolName: string,
  result: ToolResult,
): Promise<CappedResultSpill | undefined> {
  const { runId } = context;
  if (runId === undefined || !runCanReadArtifacts(context, toolName)) {
    return undefined;
  }
  const part = storedRendering(toolName, result);
  const maxBytes = artifactMaxBytes(context);
  if (part.content.byteLength > maxBytes) return { kind: 'not-stored' };
  return await writeSpillPart(context, toolName, part, { runId, maxBytes });
}

/**
 * The model rendering as a part (design D2): a JSON rendering is stored
 * pretty-printed, one member or item on each line, so a long value stays
 * readable by line; a text rendering is stored as rendered.
 */
function storedRendering(toolName: string, result: ToolResult): StoredPart {
  const rendering = renderToolResultForModel(toolName, result);
  const json = rendering.kind === 'json';
  return {
    contentType: json ? 'application/json' : 'text/plain',
    content: Buffer.from(
      json ? JSON.stringify(rendering.value, null, 2) : rendering.text,
      'utf8',
    ),
  };
}

async function writeSpillPart(
  context: ToolContext,
  toolName: string,
  part: StoredPart,
  bounds: { readonly runId: string; readonly maxBytes: number },
): Promise<CappedResultSpill> {
  try {
    const written = await writeToolArtifact(
      context.tenantDb,
      {
        chatId: context.chatId,
        userId: context.userId,
        runId: bounds.runId,
        toolCallId: context.toolCallId ?? toolName,
        toolName,
        complete: true,
        parts: [part],
      },
      { maxBytes: bounds.maxBytes },
    );
    return {
      kind: 'stored',
      locator: written.locator,
      lineCount: written.lineCount,
    };
  } catch {
    return { kind: 'not-stored' };
  }
}
