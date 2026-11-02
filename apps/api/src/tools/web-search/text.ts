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
 * text can start a line the shape gives meaning to. A URL renders as stored.
 */

import { z } from 'zod';

import { oneLine } from '@workspace/native-file-tools';

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
const outputSchema: z.ZodType<WebSearchSuccess & CapMarker> =
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

/** One stored text as `> ` lines; a trailing line break adds no empty line. */
function quoteLines(text: string): Array<string> {
  return text
    .replace(/[\r\n]+$/u, '')
    .split(/\r\n|\r|\n/u)
    .map((line) => `> ${line}`);
}

/**
 * One result as its block. A URL that names no host leaves the shape without
 * its required host line, so that result keeps its JSON rendering instead.
 */
function resultBlock(
  result: RawResult,
  rank: number,
): Array<string> | undefined {
  const host = URL.parse(result.url)?.host;
  if (!host) return undefined;
  const published = result.published?.slice(0, ISO_DATE_WIDTH);
  return [
    `## ${rank}. ${oneLine(result.title).trim() || result.url}`,
    result.url,
    published === undefined ? host : `${host} · ${oneLine(published)}`,
    ...(result.snippet === undefined ? [] : quoteLines(result.snippet)),
  ];
}

/** One grounded answer as its block: its header, its text, its citations. */
function answerBlock(answer: RawAnswer): Array<string> {
  return [
    `## Answer (${oneLine(answer.engine)})`,
    ...quoteLines(answer.answer),
    ...answer.citations.map(
      (citation, index) => `[${index + 1}] ${citation.url}`,
    ),
  ];
}

/** The text: the framing line, one block per result or answer, then the notes
 *  and the cap notice the generic result cap writes last. */
function assemble(
  output: WebSearchSuccess & CapMarker,
  blocks: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const body = blocks.flatMap((block, index) =>
    index === 0 ? block : ['', ...block],
  );
  const notice = output.truncationNotice;
  return [
    `[engine: ${oneLine(output.engine)}; query: ${oneLine(output.query)}]`,
    ...body,
    ...(output.notes ?? []).map((note) => `[${oneLine(note)}]`),
    ...(notice ? [`[${oneLine(notice)}]`] : []),
  ].join('\n');
}

/**
 * The text shape of a `web_search` success, or `undefined` for any other
 * result — a failure, and a payload that is not one of the two closed shapes.
 */
export function renderWebSearchText(result: ToolResult): string | undefined {
  const parsed = outputSchema.safeParse(result);
  if (!parsed.success) return undefined;
  const output = parsed.data;
  if (output.kind === 'answer') return assemble(output, [answerBlock(output)]);
  const blocks: Array<Array<string>> = [];
  for (const [index, item] of output.results.entries()) {
    const block = resultBlock(item, index + 1);
    if (block === undefined) return undefined;
    blocks.push(block);
  }
  blocks.push(...(output.answers ?? []).map(answerBlock));
  return assemble(output, blocks);
}
