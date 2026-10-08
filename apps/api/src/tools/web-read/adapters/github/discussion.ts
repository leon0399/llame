import { z } from 'zod';

import type { WebRequestInit } from '../../http-client';
import { primaryFailure, type WebAdapterOutcome } from '../contract';
import { formatItemBody, formatLabels } from './document';
import { NULLABLE, USER, parseGithub } from './payload';
import {
  finishRendered,
  requestJson,
  type GithubReadOptions,
  type GithubRequestContext,
} from './request';
import type { GithubDiscussionTarget } from './url';

const COMMENT_PAGE_SIZE = 100;
const REPLY_PAGE_SIZE = 100;

/** Discussions have no REST endpoint, so one GraphQL query carries the
 *  discussion with its first comments and their first replies. */
const QUERY = `query GithubDiscussion($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      number
      title
      url
      closed
      stateReason
      createdAt
      updatedAt
      body
      author { login }
      category { name }
      labels(first: 100) { nodes { name } }
      answer { author { login } createdAt url body }
      comments(first: ${COMMENT_PAGE_SIZE}) {
        totalCount
        nodes {
          author { login }
          createdAt
          url
          body
          isAnswer
          replies(first: ${REPLY_PAGE_SIZE}) {
            totalCount
            nodes { author { login } createdAt url body }
          }
        }
      }
    }
  }
}`;

const AUTHORED_WIRE = z.object({
  author: USER,
  createdAt: z.string(),
  url: z.string(),
  body: z.string(),
});
/** A connection's nodes are nullable where GitHub could not resolve one. */
const COMMENT_WIRE = AUTHORED_WIRE.extend({
  isAnswer: z.boolean(),
  replies: z.object({
    totalCount: z.number().int().nonnegative(),
    nodes: z
      .array(AUTHORED_WIRE.nullable())
      .transform((nodes) => nodes.filter((node) => node !== null)),
  }),
});
const DISCUSSION_WIRE = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  closed: z.boolean(),
  stateReason: NULLABLE.transform((reason) => reason?.toLowerCase() ?? null),
  createdAt: z.string(),
  updatedAt: z.string(),
  body: z.string(),
  author: USER,
  category: z.object({ name: z.string() }),
  labels: z
    .object({ nodes: z.array(z.object({ name: z.string() }).nullable()) })
    .nullish()
    .transform((labels) =>
      (labels?.nodes ?? []).flatMap((label) =>
        label === null ? [] : [label.name],
      ),
    ),
  answer: AUTHORED_WIRE.nullish().transform((answer) => answer ?? null),
  comments: z.object({
    totalCount: z.number().int().nonnegative(),
    nodes: z
      .array(COMMENT_WIRE.nullable())
      .transform((nodes) => nodes.filter((node) => node !== null)),
  }),
});
/** A rate-limited GraphQL call answers HTTP 200 with an error type. */
const RESPONSE_WIRE = z.object({
  data: z
    .object({
      repository: z.object({ discussion: DISCUSSION_WIRE.nullish() }).nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ type: z.string().nullish() })).optional(),
});
type Discussion = z.infer<typeof DISCUSSION_WIRE>;
type Authored = z.infer<typeof AUTHORED_WIRE>;

/** Reads a discussion through GraphQL, which GitHub serves only to a token. */
export async function readGithubDiscussion(
  target: GithubDiscussionTarget,
  options: GithubReadOptions,
): Promise<WebAdapterOutcome> {
  const context: GithubRequestContext = {
    ...options,
    init: graphqlInit(options.init, target),
    notes: [],
  };
  const primary = await requestJson(`${options.apiOrigin}/graphql`, context);
  if (primary.kind === 'failed') return primaryFailure(primary.failure);
  const response = parseGithub(RESPONSE_WIRE, primary.body);
  if (response === undefined) return { kind: 'failed', failure: 'parse' };
  if (response.errors?.some((error) => error.type === 'RATE_LIMITED')) {
    return { kind: 'failed', failure: 'rate_limit' };
  }
  // A missing or inaccessible discussion arrives as HTTP 200 and a null.
  const discussion = response.data?.repository?.discussion;
  if (discussion === undefined || discussion === null) {
    return { kind: 'failed', failure: 'status' };
  }
  context.notes.push(...truncationNotes(discussion));
  return finishRendered(renderDiscussion(discussion), context);
}

function graphqlInit(
  init: WebRequestInit,
  target: GithubDiscussionTarget,
): WebRequestInit {
  const variables = {
    owner: target.owner,
    name: target.repo,
    number: target.number,
  };
  return {
    ...init,
    accept: 'application/json',
    body: {
      contentType: 'application/json',
      text: JSON.stringify({ query: QUERY, variables }),
    },
  };
}

function truncationNotes(discussion: Discussion): ReadonlyArray<string> {
  const { comments } = discussion;
  const notes: Array<string> = [];
  if (comments.totalCount > comments.nodes.length) {
    notes.push(
      `comments truncated: the first ${comments.nodes.length} of ${comments.totalCount}`,
    );
  }
  for (const comment of comments.nodes) {
    const { replies } = comment;
    if (replies.totalCount > replies.nodes.length) {
      notes.push(
        `replies truncated: the first ${replies.nodes.length} of ${replies.totalCount} under ${comment.url}`,
      );
    }
  }
  return notes;
}

function renderDiscussion(discussion: Discussion): string {
  const fields: Array<[string, string | null]> = [
    ['State', discussion.closed ? 'closed' : 'open'],
    ['State reason', discussion.stateReason],
    ['Category', discussion.category.name],
    ['Author', discussion.author],
    ['Created', discussion.createdAt],
    ['Updated', discussion.updatedAt],
    ['Labels', formatLabels(discussion.labels)],
    ['URL', discussion.url],
  ];
  const lines = [`# Discussion #${discussion.number}: ${discussion.title}`, ''];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  if (discussion.answer !== null) {
    lines.push('', '## Answer');
    appendComment(lines, discussion.answer, 3, []);
  }
  lines.push(
    '',
    '## Body',
    '',
    formatItemBody(discussion.body, 'No description provided.'),
    '',
    `## Comments (${discussion.comments.nodes.length})`,
  );
  for (const comment of discussion.comments.nodes) {
    appendComment(lines, comment, 3, comment.isAnswer ? ['Answer: yes'] : []);
    for (const reply of comment.replies.nodes) {
      appendComment(lines, reply, 4, [`Reply to: ${comment.author}`]);
    }
  }
  return lines.join('\n').trim();
}

function appendComment(
  lines: Array<string>,
  comment: Authored,
  depth: number,
  extra: ReadonlyArray<string>,
): void {
  lines.push(
    '',
    `${'#'.repeat(depth)} ${comment.author} · ${comment.createdAt}`,
    '',
    `URL: ${comment.url}`,
    ...extra,
    '',
    formatItemBody(comment.body, 'No comment body.'),
  );
}
