/**
 * `web_search` result spill (tool-result-artifacts D9). A call asks its
 * engines for the configured fetch size and shows at most `limit` results
 * inline, within 15,000 units. When it leaves anything out, the whole
 * normalized output is stored as one Markdown artifact in the tool's own text
 * shape and the inline text ends with the artifact notice; a Run that cannot
 * read artifacts, or a write that fails, keeps the inline result and a line
 * that counts what was left out.
 *
 * The artifact records one finding per result and per answer, with the
 * artifact line range of the block that holds it, so `read` can re-check each
 * URL against the current `read` group.
 */

import { DEFAULT_ARTIFACT_MAX_BYTES } from '../../instance-config/llame-config';
import {
  writeToolArtifact,
  type WrittenArtifact,
} from '../artifacts/artifact-writer';
import { artifactFindings, type ArtifactFinding } from '../artifacts/findings';
import { artifactLineCount } from '../artifacts/lines';
import { canReadArtifacts } from '../artifacts/readable';
import { type ToolContext, type ToolResult } from '../types';
import { machineWorkspaceRoot } from '../workspace-path';
import { type SearchChainSuccess } from './chain';
import {
  normalizeFullOutput,
  normalizeOutput,
  type WebSearchSuccess,
} from './output';
import {
  renderWebSearchOutput,
  renderWebSearchText,
  type RenderedWebSearchText,
} from './text';

/** The whole result, kept as text, and the inline part the model reads. */
export type WebSearchSpill = {
  readonly limit: number;
  readonly fetchSize: number;
};

/**
 * The normalized result of one call: the inline output, the artifact locator
 * when the rest was stored, and the one line the text ends with.
 */
export async function spillWebSearchResult(
  context: ToolContext,
  source: SearchChainSuccess,
  { limit, fetchSize }: WebSearchSpill,
): Promise<ToolResult> {
  const full = normalizeFullOutput(source, fetchSize);
  const inline = normalizeOutput(source, limit);
  if (JSON.stringify(full) === JSON.stringify(inline)) return inline;

  const inlineText = renderWebSearchText(inline) ?? '';
  const rendered = renderWebSearchOutput(full);
  const written =
    rendered === undefined
      ? undefined
      : await storeArtifact(context, full, rendered);
  const notice =
    written === undefined || rendered === undefined
      ? leftOutNotice(full, inline)
      : artifactNotice(context, written, rendered.text, inlineText);
  return {
    ...inline,
    ...(written !== undefined && { artifact: written.locator }),
    truncationNotice: notice,
  };
}

/**
 * Store the whole output, or nothing. The Run must reach the locator, and the
 * text must fit `tools.artifacts.maxBytes`; a write that fails leaves the
 * inline result as the only copy (tool-result-artifacts D13).
 */
async function storeArtifact(
  context: ToolContext,
  full: WebSearchSuccess,
  rendered: RenderedWebSearchText,
): Promise<WrittenArtifact | undefined> {
  const { runId, toolCallId, userId, chatId } = context;
  if (runId === undefined || toolCallId === undefined) return undefined;
  if (!canReadArtifacts(context, 'web_search')) return undefined;
  const content = Buffer.from(rendered.text, 'utf8');
  const maxBytes = context.artifactMaxBytes ?? DEFAULT_ARTIFACT_MAX_BYTES;
  if (content.byteLength > maxBytes) return undefined;
  try {
    return await writeToolArtifact(
      context.tenantDb,
      {
        chatId,
        userId,
        runId,
        toolCallId,
        toolName: 'web_search',
        complete: true,
        parts: [
          {
            contentType: 'text/markdown',
            content,
            findings: artifactFindings(findingsOf(full, rendered)),
          },
        ],
      },
      {
        maxBytes,
        hostFiles: context.artifactHostFiles === true,
      },
    );
  } catch {
    return undefined;
  }
}

/** One finding per result and one per answer, with its block's line range. */
function findingsOf(
  full: WebSearchSuccess,
  rendered: RenderedWebSearchText,
): Array<ArtifactFinding> {
  if (full.kind === 'answer') {
    const block = rendered.blocks[0];
    return block === undefined
      ? []
      : [
          {
            locators: full.citations.map((citation) => citation.url),
            rule: 'reject_only',
            start: block.start,
            end: block.end,
          },
        ];
  }
  const findings: Array<ArtifactFinding> = [];
  for (const [index, result] of full.results.entries()) {
    const block = rendered.blocks[index];
    if (block === undefined) continue;
    findings.push({
      locators: [result.url],
      rule: 'reject_only',
      start: block.start,
      end: block.end,
    });
  }
  for (const [index, answer] of (full.answers ?? []).entries()) {
    const block = rendered.blocks[full.results.length + index];
    if (block === undefined) continue;
    findings.push({
      locators: answer.citations.map((citation) => citation.url),
      rule: 'reject_only',
      start: block.start,
      end: block.end,
    });
  }
  return findings;
}

/**
 * The artifact notice: the locator, its line count, and the first artifact
 * line the inline text does not show. The host-file clause follows when the
 * files exist (tool-result-artifacts D10).
 */
function artifactNotice(
  context: ToolContext,
  written: WrittenArtifact,
  fullText: string,
  inlineText: string,
): string {
  const lines = artifactLineCount(fullText);
  const next = nextArtifactLine(fullText, inlineText);
  return (
    `full result: ${written.locator} (${lines} ${lines === 1 ? 'line' : 'lines'}); ` +
    `continue with ${written.locator}:${next}-${hostFilesSuffix(context, written)}`
  );
}

/** The first artifact line the inline text does not show, 1-based. */
function nextArtifactLine(fullText: string, inlineText: string): number {
  const full = fullText.split('\n');
  const inline = inlineText.split('\n');
  let index = 0;
  while (index < inline.length && inline[index] === full[index]) index += 1;
  return Math.min(index + 1, full.length);
}

/** The host-file clause of the notice, or nothing when no file was written. */
function hostFilesSuffix(
  context: ToolContext,
  written: WrittenArtifact,
): string {
  const files = written.hostFiles;
  if (files === undefined) return '';
  return machineWorkspaceRoot(context.workspaceRoot?.current()) === undefined
    ? `; host files in ${files.directory}`
    : '; host files on the llame host only';
}

/** The line a call without an artifact ends with: what it left out. */
function leftOutNotice(
  full: WebSearchSuccess,
  inline: WebSearchSuccess,
): string {
  const count = leftOutCount(full, inline);
  return `left out: ${count} ${count === 1 ? 'result' : 'results'}; full result not stored`;
}

/** How many results, answers, or citations the inline text leaves out. */
function leftOutCount(
  full: WebSearchSuccess,
  inline: WebSearchSuccess,
): number {
  if (full.kind === 'answer' && inline.kind === 'answer') {
    const citations = full.citations.length - inline.citations.length;
    return citations > 0 ? citations : 1;
  }
  if (full.kind !== 'results' || inline.kind !== 'results') return 1;
  const answers = full.answers ?? [];
  const inlineAnswers = inline.answers ?? [];
  const citations =
    answers.reduce((total, answer) => total + answer.citations.length, 0) -
    inlineAnswers.reduce((total, answer) => total + answer.citations.length, 0);
  const dropped =
    full.results.length -
    inline.results.length +
    (answers.length - inlineAnswers.length) +
    citations;
  return dropped > 0 ? dropped : 1;
}
