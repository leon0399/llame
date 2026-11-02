/**
 * The model-facing text of a `web_search` success (tool-result-rendering
 * "A web search renders as numbered results", "Web search answers render after
 * the results", "Web text cannot forge structure", "Artifact framing values
 * render on one line", "A cap notice ends the text").
 *
 * One `[engine: <id>; query: <query>]` line opens the text. Each result is one
 * block: a `## <rank>. <title>` line, its URL, the host with the published date
 * when the vendor gave one, and its snippet as `> ` lines. An answer output,
 * and each answer an aggregate attaches, is a `## Answer (<engine>)` block with
 * the answer as `> ` lines and its citations as `[<k>] <url>` lines. Notes
 * follow as one bracketed line each, and the generic result cap's notice ends
 * the text.
 *
 * The title, the host line, and the framing values fold their line breaks into
 * spaces, and every snippet and answer line begins with `> `. So no stored
 * text can start a line the shape gives meaning to. A URL renders as stored,
 * with each line break folded to one space.
 */

import { z } from 'zod';

import { oneLine } from '@workspace/native-file-tools';

import { artifactLinePieces } from '../artifacts/lines';

import { type ToolResult } from '../types';
import { type RawAnswer, type RawResult } from './chain';
import { type WebSearchSuccess } from './output';

/** The marker fields the generic result cap writes on a shortened result. */
type CapMarker = {
  readonly truncated?: boolean;
  readonly truncationNotice?: string;
};

/** A stored result as the normalized output keeps it. */
const resultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  published: z.string().optional(),
});

const citationSchema = z.object({
  url: z.string(),
});

/** One answer an aggregate attaches, named by the child that gave it. */
const answerSchema = z.object({
  engine: z.string(),
  answer: z.string(),
  citations: z.array(citationSchema),
});

/** The fields both closed outputs carry: the call's framing, its notes, and
 *  the generic result cap's marker. */
const outputEnvelopeFields = {
  status: z.literal('success'),
  engine: z.string(),
  query: z.string(),
  notes: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
  truncationNotice: z.string().optional(),
};

/**
 * The two closed shapes a normalized output takes, typed against the shape the
 * tool produces so the two cannot drift. A part that matches neither — a
 * legacy part, or a payload another build wrote — keeps its JSON rendering.
 */
export const webSearchOutputSchema: z.ZodType<WebSearchSuccess & CapMarker> =
  z.discriminatedUnion('kind', [
    z.object({
      ...outputEnvelopeFields,
      kind: z.literal('results'),
      results: z.array(resultSchema),
      answers: z.array(answerSchema).optional(),
    }),
    z.object({
      ...outputEnvelopeFields,
      kind: z.literal('answer'),
      answer: z.string(),
      citations: z.array(citationSchema),
    }),
  ]);

/** The width of an ISO 8601 date, which is the part a host line shows. */
const ISO_DATE_WIDTH = 10;

/** One block of the text shape: its source locators and its rendered lines. */
type TextBlock = {
  readonly locators: ReadonlyArray<string>;
  readonly lines: Array<string>;
};

/**
 * A block's place in the artifact-line numbering, both ends 1-based. The
 * reader numbers every 8,000-unit piece of a long line as its own line, so the
 * range counts pieces (tool-result-artifacts D2).
 */
export type WebSearchTextBlock = {
  /** The URLs a finding re-checks: a result URL, or an answer's citations. */
  readonly locators: ReadonlyArray<string>;
  /** The first artifact line of the block, its heading line included. */
  readonly start: number;
  /** The last artifact line of the block, inclusive. */
  readonly end: number;
};

/** The rendered text and the line range of every result or answer block. */
export type RenderedWebSearchText = {
  readonly text: string;
  readonly blocks: ReadonlyArray<WebSearchTextBlock>;
};

/** One stored text as `> ` lines; a trailing line break adds no empty line. */
function quoteLines(text: string): Array<string> {
  return text
    .replace(/[\r\n\u2028\u2029]+$/u, '')
    .split(/\r\n|[\r\n\u2028\u2029]/u)
    .map((line) => `> ${line}`);
}

/**
 * One result as its block. A URL that names no host leaves the shape without
 * its required host line, so that result keeps its JSON rendering instead.
 */
function resultBlock(result: RawResult, rank: number): TextBlock | undefined {
  const host = URL.parse(result.url)?.host;
  if (!host) return undefined;
  const published = result.published?.slice(0, ISO_DATE_WIDTH);
  return {
    locators: [result.url],
    lines: [
      `## ${rank}. ${oneLine(result.title).trim() || oneLine(result.url)}`,
      oneLine(result.url),
      published === undefined ? host : `${host} · ${oneLine(published)}`,
      ...(result.snippet === undefined ? [] : quoteLines(result.snippet)),
    ],
  };
}

/** One grounded answer as its block: its header, its text, its citations. */
function answerBlock(answer: RawAnswer): TextBlock {
  return {
    locators: answer.citations.map((citation) => citation.url),
    lines: [
      `## Answer (${oneLine(answer.engine)})`,
      ...quoteLines(answer.answer),
      ...answer.citations.map(
        (citation, index) => `[${index + 1}] ${oneLine(citation.url)}`,
      ),
    ],
  };
}

/** How many artifact lines one rendered line takes: pieces, or one if empty. */
function renderedLineSpan(line: string): number {
  return Math.max(1, artifactLinePieces(line).length);
}

/**
 * The text: the framing line, one block per result or answer, then the notes
 * and the cap notice the generic result cap writes last. Every block keeps the
 * artifact line range the reader numbers it with, so a line over 8,000 units
 * shifts the ranges after it by the pieces it occupies.
 */
function assemble(
  output: WebSearchSuccess & CapMarker,
  blocks: ReadonlyArray<TextBlock>,
): RenderedWebSearchText {
  const lines = [
    `[engine: ${oneLine(output.engine)}; query: ${oneLine(output.query)}]`,
  ];
  const ranges: Array<WebSearchTextBlock> = [];
  // The framing line is artifact line 1, and the notes that follow the blocks
  // hold no finding.
  let next = 2;
  for (const [index, block] of blocks.entries()) {
    if (index > 0) {
      lines.push('');
      next += 1;
    }
    const start = next;
    lines.push(...block.lines);
    for (const line of block.lines) next += renderedLineSpan(line);
    ranges.push({ locators: block.locators, start, end: next - 1 });
  }
  const notice = output.truncationNotice;
  lines.push(
    ...(output.notes ?? []).map((note) => `[${oneLine(note)}]`),
    ...(notice ? [`[${oneLine(notice)}]`] : []),
  );
  return { text: lines.join('\n'), blocks: ranges };
}

/**
 * The rendered text of one normalized output, or `undefined` when it is not
 * one of the two closed shapes. The producer uses the block ranges for its
 * findings; the model reads `text`.
 */
export function renderWebSearchOutput(
  output: WebSearchSuccess & CapMarker,
): RenderedWebSearchText | undefined {
  if (output.kind === 'answer') return assemble(output, [answerBlock(output)]);
  const blocks: Array<TextBlock> = [];
  for (const [index, item] of output.results.entries()) {
    const block = resultBlock(item, index + 1);
    if (block === undefined) return undefined;
    blocks.push(block);
  }
  blocks.push(...(output.answers ?? []).map(answerBlock));
  return assemble(output, blocks);
}

/**
 * The text shape of a `web_search` success, or `undefined` for any other
 * result — a failure, and a payload that is not one of the two closed shapes.
 */
export function renderWebSearchText(result: ToolResult): string | undefined {
  const parsed = webSearchOutputSchema.safeParse(result);
  return parsed.success ? renderWebSearchOutput(parsed.data)?.text : undefined;
}
