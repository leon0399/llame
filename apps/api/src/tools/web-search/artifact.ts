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
import {
  type RenderedWebSearchText,
  renderWebSearchOutput,
  type WebSearchTextBlock,
} from './text';

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
    rendered === undefined ? undefined : await storeArtifact(context, rendered);
  const notice =
    written === undefined || rendered === undefined
      ? leftOutNotice(full, inline)
      : storedNotice(
          context,
          written,
          nextArtifactLine(
            rendered.blocks,
            renderWebSearchOutput(inline)?.blocks ?? [],
          ),
        );
  return {
    ...inline,
    ...(written !== undefined && { artifact: written.locator }),
    truncationNotice: notice,
  };
}

/** Store the whole rendered output with one finding for each block. */
function storeArtifact(
  context: ToolContext,
  rendered: RenderedWebSearchText,
): Promise<WrittenArtifact | undefined> {
  return storeSinglePartArtifact(context, 'web_search', {
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
      hostFiles,
    },
  );
  return notice.slice(1, -1);
}

/** The first block always starts here; line 1 is the framing line. */
const FIRST_BLOCK_LINE = 2;

/**
 * The continuation line: the artifact line after the last block the inline
 * text reproduces. Blocks, not a text diff, decide it, so an attached answer
 * after the inline results cannot move the continuation into an answer.
 */
function nextArtifactLine(
  fullBlocks: ReadonlyArray<WebSearchTextBlock>,
  inlineBlocks: ReadonlyArray<WebSearchTextBlock>,
): number {
  const reproduced = reproducedBlocks(fullBlocks, inlineBlocks);
  const boundary = fullBlocks[reproduced - 1];
  return boundary === undefined ? FIRST_BLOCK_LINE : boundary.end + 1;
}

/** How many leading blocks the inline output keeps exactly as the full one. */
function reproducedBlocks(
  full: ReadonlyArray<WebSearchTextBlock>,
  inline: ReadonlyArray<WebSearchTextBlock>,
): number {
  let reproduced = 0;
  for (const block of inline) {
    if (block.end !== full[reproduced].end) break;
    reproduced += 1;
  }
  return reproduced;
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
    if (inline.kind !== 'answer') return 0;
    return full.citations.length - inline.citations.length;
  }
  if (inline.kind !== 'results') return 0;
  const answers = full.answers ?? [];
  const inlineAnswers = inline.answers ?? [];
  const keptFullCitations = answers
    .slice(0, inlineAnswers.length)
    .reduce((total, answer) => total + answer.citations.length, 0);
  const keptInlineCitations = inlineAnswers.reduce(
    (total, answer) => total + answer.citations.length,
    0,
  );
  return (
    full.results.length -
    inline.results.length +
    (answers.length - inlineAnswers.length) +
    (keptFullCitations - keptInlineCitations)
  );
}
