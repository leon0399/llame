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
  INLINE_NOTICE_RESERVE,
  normalizeFullOutput,
  normalizeOutput,
  WEB_SEARCH_RANK_FAILURE_NOTE,
  type WebSearchSuccess,
} from './output';
import {
  prepareSource,
  rankWebSearchResults,
  type WebSearchRanking,
  type WebSearchRerankRecord,
} from './rerank';
import {
  type RenderedWebSearchText,
  renderWebSearchOutput,
  type WebSearchTextBlock,
} from './text';

/** The inline result count, the fetched size, and the search's goal. */
export type WebSearchSpill = {
  readonly limit: number;
  readonly fetchSize: number;
  /** The call's `objective`, the decision lane's ranking criterion. */
  readonly objective?: string;
};

/**
 * The normalized result of one call: the inline output, the artifact locator
 * when the rest was stored, and the one line the text ends with.
 *
 * The call's source is deduplicated and, with a rank model, key-protected and
 * ranked here, once. Both normalize calls read the same source, so the inline
 * head, the stored artifact text, its findings, and the continuation line share
 * one order.
 */
export async function spillWebSearchResult(
  context: ToolContext,
  received: SearchChainSuccess,
  { limit, fetchSize, objective }: WebSearchSpill,
): Promise<ToolResult> {
  const { source, record, full, whole } = await rankedSpillSource(
    context,
    received,
    { limit, fetchSize, objective },
  );

  if (JSON.stringify(full) === JSON.stringify(whole))
    return { ...whole, ...record };

  // The inline body shares the 15,000-unit bound with the notice this path
  // adds, so it is fitted with the notice's room kept back.
  const inline = normalizeOutput(source, limit, INLINE_NOTICE_RESERVE);
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
    ...record,
  };
}

type SpillSource = {
  readonly source: SearchChainSuccess;
  readonly record: {
    readonly display?: { readonly rerank: WebSearchRerankRecord };
  };
  readonly full: WebSearchSuccess;
  readonly whole: WebSearchSuccess;
};

/**
 * The deduplicated, key-protected source, ranked unless the whole of it fits
 * inline, with the full and inline-cut outputs both normalize calls produce
 * from it and the `display` field a ranked call stores.
 */
async function rankedSpillSource(
  context: ToolContext,
  received: SearchChainSuccess,
  { limit, fetchSize, objective }: WebSearchSpill,
): Promise<SpillSource> {
  const prepared = prepareSource(context, received);

  const count = retainsMergedSet(context, prepared)
    ? Number.POSITIVE_INFINITY
    : fetchSize;

  const full = normalizeFullOutput(prepared, count);
  const whole = normalizeOutput(prepared, limit);
  const fits = JSON.stringify(full) === JSON.stringify(whole);

  const ranking =
    prepared.kind === 'results' && !fits
      ? await rankWebSearchResults(context, prepared, objective)
      : undefined;

  if (prepared.kind !== 'results' || ranking === undefined)
    return { source: prepared, record: {}, full, whole };
  const source = rankedSource(prepared, ranking);

  return {
    source,
    record:
      ranking.status === 'ranked'
        ? { display: { rerank: ranking.record } }
        : {},
    full: normalizeFullOutput(source, count),
    whole: normalizeOutput(source, limit),
  };
}

/** The ranked source, or the prepared one with the failure note appended. */
function rankedSource(
  prepared: Extract<SearchChainSuccess, { kind: 'results' }>,
  ranking: WebSearchRanking,
): SearchChainSuccess {
  return ranking.status === 'ranked'
    ? ranking.source
    : {
        ...prepared,
        notes: [...(prepared.notes ?? []), WEB_SEARCH_RANK_FAILURE_NOTE],
      };
}

/** Whether the winning engine is an aggregate that keeps every merged result. */
function retainsMergedSet(
  context: ToolContext,
  source: SearchChainSuccess,
): boolean {
  return (
    context.webSearch?.rerank !== undefined &&
    context.webSearch.engines.some(
      (entry) => entry.id === source.engine && entry.type === 'aggregate',
    )
  );
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
    if (block.text !== full[reproduced].text) break;
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

    return (
      full.citations.length -
      inline.citations.length +
      (full.answer === inline.answer ? 0 : 1)
    );
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

  const cutAnswers = inlineAnswers.filter(
    (answer, index) => answer.answer !== answers[index].answer,
  ).length;

  return (
    full.results.length -
    inline.results.length +
    (answers.length - inlineAnswers.length) +
    (keptFullCitations - keptInlineCitations) +
    cutAnswers
  );
}
