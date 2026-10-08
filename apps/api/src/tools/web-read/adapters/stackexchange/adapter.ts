import { parseHTML } from 'linkedom';
import { z } from 'zod';

import type { StackexchangeWebAdapterConfig } from '../../../../instance-config/llame-config';
import type {
  WebFetchFailure,
  WebRequestInit,
  WebResponse,
} from '../../http-client';
import { convertToMarkdown } from '../../pipeline';
import {
  loadSection,
  parseJsonBody,
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';

/** The Stack Exchange API; keyless reads share a 300-request daily quota
 *  per IP address. */
export const STACKEXCHANGE_API_ORIGIN = 'https://api.stackexchange.com';

const JSON_INIT: WebRequestInit = { accept: 'application/json' };
const ANSWER_PAGE_SIZE = '100';

/** Stack Exchange Q&A hosts, metas included; the API takes the host itself as
 *  its `site` parameter. */
const SITE_HOST =
  /^(?:(?:(?:meta|[a-z]{2})\.)?stackoverflow\.com|superuser\.com|serverfault\.com|askubuntu\.com|mathoverflow\.net|stackapps\.com|(?:[a-z0-9]+\.){1,2}stackexchange\.com)$/u;
/** A question with an optional slug and answer id (the answer permalink),
 *  or a `/q/` or `/a/` share link. */
const POST_PATH =
  /^\/(?:questions\/(\d{1,12})(?:\/[^/]*(?:\/\d{1,12})?)?|q\/(\d{1,12})(?:\/\d+)?|a\/(\d{1,12})(?:\/\d+)?)$/u;

type StackexchangeTarget = {
  readonly site: string;
  readonly question?: string;
  readonly answer?: string;
};

const OWNER = z
  .object({ display_name: z.string().optional() })
  .optional()
  .transform((owner) => decodeText(owner?.display_name ?? 'deleted user'));
const QUESTION_PAGE = z.object({
  items: z.array(
    z.object({
      question_id: z.number().int(),
      title: z.string().transform(decodeText),
      body: z.string(),
      link: z.string(),
      score: z.number().int(),
      answer_count: z.number().int(),
      view_count: z.number().int().optional(),
      tags: z.array(z.string()),
      owner: OWNER,
      creation_date: z.number().int(),
      content_license: z.string().optional(),
      closed_reason: z.string().optional(),
    }),
  ),
});
type Question = z.infer<typeof QUESTION_PAGE>['items'][number];
const ANSWER = z.object({
  answer_id: z.number().int(),
  body: z.string(),
  score: z.number().int(),
  is_accepted: z.boolean(),
  owner: OWNER,
  creation_date: z.number().int(),
});
type Answer = z.infer<typeof ANSWER>;
const ANSWER_PAGE = z.object({
  items: z.array(ANSWER),
  has_more: z.boolean().optional(),
});
const ANSWER_LOOKUP = z.object({
  items: z.array(z.object({ question_id: z.number().int() })),
});

/** Matches question, `/q/`, and `/a/` share links on Stack Exchange sites. */
export function parseStackexchangeUrl(
  source: URL,
): StackexchangeTarget | undefined {
  if (source.protocol !== 'https:') return undefined;
  const site = source.host.replace(/^www\./u, '');
  const match = POST_PATH.exec(source.pathname);
  if (!SITE_HOST.test(site) || match === null) return undefined;
  const [, question, short, answer] = match;
  return answer === undefined
    ? { site, question: question ?? short }
    : { site, answer };
}

/** Creates the native Stack Exchange adapter. */
export function createStackexchangeAdapter(
  config: StackexchangeWebAdapterConfig,
  options: { readonly apiOrigin?: string } = {},
): WebAdapter {
  const api = options.apiOrigin ?? STACKEXCHANGE_API_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseStackexchangeUrl(source) !== undefined,
    read: (source, io) => readThread(parseStackexchangeUrl(source)!, io, api),
  };
}

type Query = (
  path: string,
  extra?: string,
) => Promise<WebResponse | WebFetchFailure>;

/** The question is primary; its answers are a secondary section. An `/a/`
 *  link first resolves its question, then reads the whole thread. */
async function readThread(
  target: StackexchangeTarget,
  io: WebAdapterIo,
  api: string,
): Promise<WebAdapterOutcome> {
  const query: Query = (path, extra = '') =>
    io.fetch(`${api}/2.3/${path}?site=${target.site}${extra}`, JSON_INIT);
  const resolved =
    target.question === undefined
      ? await questionOf(target, query)
      : { id: target.question };
  if ('outcome' in resolved) return resolved.outcome;

  const fetched = await query(`questions/${resolved.id}`, '&filter=withbody');
  if ('type' in fetched) return primaryFailure(fetched);
  const page = parseJsonBody(fetched.body, QUESTION_PAGE);
  if (page === undefined) return { kind: 'failed', failure: 'parse' };
  const question = page.items[0];
  if (question === undefined) return { kind: 'failed', failure: 'empty' };

  const notes: Array<string> = [];
  const answers = await loadAnswers(query, resolved.id, notes);
  if ('fatal' in answers) return primaryFailure(answers.fatal);
  return {
    kind: 'rendered',
    content: renderThread(question, answers.items),
    mediaType: 'text/markdown',
    notes,
  };
}

/** An `/a/` link's question id, or the outcome that ends the read. */
async function questionOf(
  target: StackexchangeTarget,
  query: Query,
): Promise<{ readonly id: string } | { readonly outcome: WebAdapterOutcome }> {
  const lookup = await query(`answers/${target.answer}`);
  if ('type' in lookup) return { outcome: primaryFailure(lookup) };
  const page = parseJsonBody(lookup.body, ANSWER_LOOKUP);
  if (page === undefined)
    return { outcome: { kind: 'failed', failure: 'parse' } };
  const owner = page.items[0];
  return owner === undefined
    ? { outcome: { kind: 'failed', failure: 'empty' } }
    : { id: String(owner.question_id) };
}

async function loadAnswers(
  query: Query,
  questionId: string,
  notes: Array<string>,
): Promise<
  | { readonly items?: ReadonlyArray<Answer> }
  | { readonly fatal: WebFetchFailure }
> {
  const answers = await loadSection(
    'answers',
    query(
      `questions/${questionId}/answers`,
      `&filter=withbody&sort=votes&order=desc&pagesize=${ANSWER_PAGE_SIZE}`,
    ),
    notes,
  );
  if ('fatal' in answers) return answers;
  if (answers.body === undefined) return {};
  const page = parseJsonBody(answers.body, ANSWER_PAGE);
  if (page === undefined) notes.push('answers omitted: parse');
  if (page?.has_more === true) {
    notes.push(`answers truncated: the first ${ANSWER_PAGE_SIZE} by score`);
  }
  return page === undefined ? {} : { items: page.items };
}

function renderThread(
  question: Question,
  answers: ReadonlyArray<Answer> | undefined,
): string {
  const views =
    question.view_count === undefined
      ? ''
      : ` · Views: ${formatCount(question.view_count)}`;
  const lines = [
    `# ${question.title}`,
    '',
    `Score: ${formatCount(question.score)} · Answers: ${formatCount(question.answer_count)}${views}`,
    `Tags: ${question.tags.join(', ')}`,
    `Asked: ${isoDate(question.creation_date)} by ${question.owner}`,
  ];
  if (question.closed_reason) lines.push(`Closed: ${question.closed_reason}`);
  if (question.content_license) {
    lines.push(`License: ${question.content_license}`);
  }
  lines.push(
    `URL: ${question.link}`,
    '',
    '## Question',
    '',
    convertToMarkdown(question.body).trim(),
  );

  // Stack Overflow lists the accepted answer first, then by score.
  const ordered = [...(answers ?? [])].sort(
    (left, right) => Number(right.is_accepted) - Number(left.is_accepted),
  );
  ordered.forEach((answer, index) => {
    lines.push(
      ...answerLines(answer, `${index + 1}/${ordered.length}`, question.link),
    );
  });
  return lines.join('\n');
}

function answerLines(
  answer: Answer,
  position: string,
  questionLink: string,
): Array<string> {
  const accepted = answer.is_accepted ? 'accepted · ' : '';
  return [
    '',
    '---',
    '',
    `## Answer · ${position} — ${accepted}score ${formatCount(answer.score)} — ${answer.owner}`,
    '',
    convertToMarkdown(answer.body).trim(),
    '',
    `Source: ${questionLink.replace(/\/questions\/.*/u, `/a/${answer.answer_id}`)}`,
    `Date: ${isoDate(answer.creation_date)}`,
  ];
}

/** Titles and names arrive HTML-encoded. */
function decodeText(text: string): string {
  return (
    parseHTML(`<!doctype html><html><body>${text}</body></html>`).document.body
      .textContent ?? text
  );
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
