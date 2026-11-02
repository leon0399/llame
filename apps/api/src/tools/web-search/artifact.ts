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

import { artifactNotice } from '@workspace/runtime-safety';

import { type WrittenArtifact } from '../artifacts/artifact-writer';
import { artifactFindings } from '../artifacts/findings';
import { artifactHostFiles, storeSinglePartArtifact } from '../artifacts/spill';
import { type ToolContext, type ToolResult } from '../types';
import { type SearchChainSuccess } from './chain';
import {
  normalizeFullOutput,
  normalizeOutput,
  type WebSearchSuccess,
} from './output';
import { renderWebSearchOutput, type WebSearchTextBlock } from './text';

/** The inline result count and the fetched size. */
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

  const rendered = renderWebSearchOutput(full);
  const written =
    rendered === undefined
      ? undefined
      : await storeSinglePartArtifact(context, 'web_search', {
          contentType: 'text/markdown',
          content: rendered.text,
          findings: artifactFindings(
            rendered.blocks.map((block) => ({
              locators: block.locators,
              rule: 'reject_only' as const,
              start: block.start,
              end: block.end,
            })),
          ),
        });
  const notice =
    written === undefined || rendered === undefined
      ? leftOutNotice(full, inline)
      : storedNotice(
          context,
          written,
          nextArtifactLine(rendered.blocks, full, inline),
        );
  return {
    ...inline,
    ...(written !== undefined && { artifact: written.locator }),
    truncationNotice: notice,
  };
}

/**
 * The artifact notice, bracket-free because the text renderer adds the pair:
 * the locator, its line count, the first artifact line the inline text does
 * not show, and the host files when they exist (tool-result-artifacts D10).
 */
function storedNotice(
  context: ToolContext,
  written: WrittenArtifact,
  next: number,
): string {
  const hostFiles = artifactHostFiles(context, 'web_search', written);
  const notice = artifactNotice(
    [{ locator: written.locator, lines: written.lineCount }],
    {
      continueWith: { locator: written.locator, next },
      ...(hostFiles !== undefined && { hostFiles }),
    },
  );
  return notice.slice(1, -1);
}

/**
 * The continuation line: the artifact line after the last block the inline
 * text reproduces. Blocks, not a text diff, decide it, so an attached answer
 * after the inline results cannot move the continuation into an answer.
 */
function nextArtifactLine(
  blocks: ReadonlyArray<WebSearchTextBlock>,
  full: WebSearchSuccess,
  inline: WebSearchSuccess,
): number {
  const reproduced = reproducedBlocks(full, inline);
  const previous = blocks[reproduced - 1];
  return previous === undefined ? (blocks[0]?.start ?? 1) : previous.end + 1;
}

/** How many leading blocks the inline output keeps exactly as the full one. */
function reproducedBlocks(
  full: WebSearchSuccess,
  inline: WebSearchSuccess,
): number {
  const fullEntries = blockEntries(full);
  const inlineEntries = blockEntries(inline);
  let reproduced = 0;
  while (
    reproduced < inlineEntries.length &&
    JSON.stringify(inlineEntries[reproduced]) ===
      JSON.stringify(fullEntries[reproduced])
  ) {
    reproduced += 1;
  }
  return reproduced;
}

/** The entries whose blocks the text renders, results first for a results output. */
function blockEntries(output: WebSearchSuccess): ReadonlyArray<unknown> {
  if (output.kind === 'answer') {
    return [{ answer: output.answer, citations: output.citations }];
  }
  return [...output.results, ...(output.answers ?? [])];
}

/** The line a call without an artifact ends with: what it left out. */
function leftOutNotice(
  full: WebSearchSuccess,
  inline: WebSearchSuccess,
): string {
  const count = leftOutCount(full, inline);
  return `left out: ${count} ${count === 1 ? 'result' : 'results'}; full result not stored`;
}

/**
 * How many results, answers, or citations the inline text leaves out. A
 * dropped answer counts once, not once per citation it carried; a kept answer
 * counts each citation it lost.
 */
function leftOutCount(
  full: WebSearchSuccess,
  inline: WebSearchSuccess,
): number {
  if (full.kind === 'answer') {
    if (inline.kind !== 'answer') return 1;
    const citations = full.citations.length - inline.citations.length;
    return citations > 0 ? citations : 1;
  }
  if (inline.kind !== 'results') return 1;
  const answers = full.answers ?? [];
  const inlineAnswers = inline.answers ?? [];
  const trimmed = inlineAnswers.reduce(
    (total, answer, index) =>
      total +
      ((answers[index]?.citations.length ?? 0) - answer.citations.length),
    0,
  );
  const dropped =
    full.results.length -
    inline.results.length +
    (answers.length - inlineAnswers.length) +
    trimmed;
  return dropped > 0 ? dropped : 1;
}
