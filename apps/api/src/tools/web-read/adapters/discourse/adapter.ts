import { z } from 'zod';

import type { DiscourseWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebFetchFailure, WebRequestInit } from '../../http-client';
import { convertToMarkdown } from '../../pipeline';
import {
  loadSection,
  parseJsonBody,
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';

const JSON_INIT: WebRequestInit = { accept: 'application/json' };
/** The most posts one read renders; a longer topic is cut with a note. */
const MAX_POSTS = 200;
/** Post ids per `posts.json` request. Discourse does not cap `post_ids`
 *  (meta.discourse.org answered 300 in one request); a chunk keeps the
 *  request line far below what a proxy accepts. */
const CHUNK_SIZE = 100;
/** An anchor with no content. Discourse opens each heading with one,
 *  `<h3><a name="p-1-usage-1" class="anchor" href="#p-1-usage-1"></a>Usage</h3>`,
 *  which would render as `### [](#p-1-usage-1)Usage`. */
const EMPTY_ANCHOR = /<a\s[^<>]*><\/a>/giu;
/** An anchor or image tag, whose root-relative attributes are resolved
 *  against the forum; code sample text spells its tags escaped, so it never
 *  matches. */
const LINK_TAG = /<(?:a|img)\b[^<>]*>/giu;
const ROOT_RELATIVE = /\b(href|src)="\/(?!\/)/gu;

type DiscourseTarget = {
  /** The source's own origin; every request stays on it. */
  readonly origin: string;
  readonly topicId: string;
};

/** `/t/{topicId}` and `/t/{topicId}/{postNumber}`, each also behind a
 *  `{slug}`, with an optional trailing slash. Discourse routes `/t/{a}/{b}`
 *  of two numbers as topic and post number and never issues an all-digit
 *  slug, so a slug is never all digits. */
const TOPIC_PATH =
  /^\/t\/(?:(?!\d+\/)[^/]+\/)?([1-9]\d{0,11})(?:\/\d{1,10})?\/?$/u;

const POST = z.object({
  id: z.number().int(),
  post_number: z.number().int(),
  /** Null once the account is deleted. */
  username: z.string().nullable().default(null),
  /** Absent when the forum turns names off; null or blank without one. */
  name: z.string().nullable().default(null),
  created_at: z.string(),
  cooked: z.string(),
  reply_to_post_number: z.number().int().nullable().default(null),
  /** A small action (closed, split, pinned) names its event here, and some
   *  carry no text. */
  action_code: z.string().nullable().default(null),
});
type Post = z.infer<typeof POST>;

const TOPIC = z.object({
  title: z.string(),
  /** `-` stands in for a slug a topic lacks; Discourse accepts it. */
  slug: z
    .string()
    .nullable()
    .default(null)
    .transform((slug) => slug || '-'),
  posts_count: z.number().int().default(0),
  post_stream: z.object({
    /** The first posts of the topic: the API's page of 20. */
    posts: z.array(POST),
    /** The id of every post. A topic of 10,000 posts or more omits it. */
    stream: z.array(z.number().int()).optional(),
  }),
});
type Topic = z.infer<typeof TOPIC>;

const POST_PAGE = z.object({ post_stream: z.object({ posts: z.array(POST) }) });

/** Matches a topic on a forum the operator listed. The query, fragment, and
 *  post number are ignored, and a host with a port is not the listed host. */
export function parseDiscourseUrl(
  source: URL,
  hosts: ReadonlyArray<string>,
): DiscourseTarget | undefined {
  if (source.protocol !== 'https:' || !hosts.includes(source.host)) {
    return undefined;
  }
  const topicId = TOPIC_PATH.exec(source.pathname)?.[1];
  return topicId === undefined ? undefined : { origin: source.origin, topicId };
}

/** Creates the native Discourse adapter. */
export function createDiscourseAdapter(
  config: DiscourseWebAdapterConfig,
): WebAdapter {
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseDiscourseUrl(source, config.hosts) !== undefined,
    read: (source, io) =>
      readTopic(parseDiscourseUrl(source, config.hosts)!, io),
  };
}

/** The topic is primary: it names the topic, carries its first posts, and
 *  lists the id of every post. The rest of the capped stream is a secondary
 *  section, read by id until a request fails. */
async function readTopic(
  target: DiscourseTarget,
  io: WebAdapterIo,
): Promise<WebAdapterOutcome> {
  const fetched = await io.fetch(
    `${target.origin}/t/${target.topicId}.json`,
    JSON_INIT,
  );
  if ('type' in fetched) return primaryFailure(fetched);
  const topic = parseJsonBody(fetched.body, TOPIC);
  if (topic === undefined) return { kind: 'failed', failure: 'parse' };

  const notes: Array<string> = [];
  const loaded = await loadPosts(target, topic, io, notes);
  if ('fatal' in loaded) return primaryFailure(loaded.fatal);
  if (loaded.posts.length === 0) return { kind: 'failed', failure: 'empty' };
  const total = topic.post_stream.stream?.length ?? topic.posts_count;
  if (total > loaded.posts.length) {
    notes.push(`posts truncated: the first ${loaded.posts.length} of ${total}`);
  }
  return {
    kind: 'rendered',
    content: renderThread(topic, target, loaded.posts),
    mediaType: 'text/markdown',
    notes,
  };
}

type LoadedPosts =
  | { readonly posts: ReadonlyArray<Post> }
  | { readonly fatal: WebFetchFailure };

/** The capped stream's posts in stream order. A request that fails or does
 *  not parse leaves a note and ends the loading, so the posts kept are the
 *  ones before it. */
async function loadPosts(
  target: DiscourseTarget,
  topic: Topic,
  io: WebAdapterIo,
  notes: Array<string>,
): Promise<LoadedPosts> {
  const opening = topic.post_stream.posts;
  const stream = topic.post_stream.stream ?? opening.map(({ id }) => id);
  const wanted = stream.slice(0, MAX_POSTS);
  const byId = new Map(opening.map((post): [number, Post] => [post.id, post]));
  const missing = wanted.filter((id) => !byId.has(id));
  for (let start = 0; start < missing.length; start += CHUNK_SIZE) {
    const ids = missing.slice(start, start + CHUNK_SIZE);
    const page = await loadChunk(target, ids, io, notes);
    if ('fatal' in page) return page;
    if (page.posts === undefined) break;
    for (const post of page.posts) byId.set(post.id, post);
  }
  return { posts: wanted.flatMap((id) => byId.get(id) ?? []) };
}

async function loadChunk(
  target: DiscourseTarget,
  ids: ReadonlyArray<number>,
  io: WebAdapterIo,
  notes: Array<string>,
): Promise<
  { readonly posts?: ReadonlyArray<Post> } | { readonly fatal: WebFetchFailure }
> {
  const query = ids.map((id) => `post_ids[]=${id}`).join('&');
  const section = await loadSection(
    'posts',
    io.fetch(
      `${target.origin}/t/${target.topicId}/posts.json?${query}`,
      JSON_INIT,
    ),
    notes,
  );
  if ('fatal' in section) return section;
  if (section.body === undefined) return {};
  const page = parseJsonBody(section.body, POST_PAGE);
  if (page === undefined) notes.push('posts omitted: parse');
  return { posts: page?.post_stream.posts };
}

type Thread = {
  readonly title: string;
  readonly origin: string;
  /** The topic's canonical URL; a post's own is this plus its number. */
  readonly url: string;
  /** The author of each post by number, for the replies that answer it. */
  readonly authors: ReadonlyMap<number, string | null>;
};

/** x.md's thread layout: the topic's first post as `Post` with the title,
 *  then every other post in stream order as `Reply`. */
function renderThread(
  topic: Topic,
  target: DiscourseTarget,
  posts: ReadonlyArray<Post>,
): string {
  const thread: Thread = {
    title: topic.title,
    origin: target.origin,
    url: `${target.origin}/t/${topic.slug}/${target.topicId}`,
    authors: new Map(
      posts.map((post): [number, string | null] => [
        post.post_number,
        post.username,
      ]),
    ),
  };
  return posts
    .map((post, index) => entryLines(post, index, posts.length, thread))
    .join('\n\n---\n\n');
}

function entryLines(
  post: Post,
  index: number,
  total: number,
  thread: Thread,
): string {
  const label = index === 0 ? 'Post' : 'Reply';
  const lines = [`## ${label} · ${index + 1}/${total} — ${authorOf(post)}`, ''];
  const replyTo = replyTarget(post, thread.authors);
  if (replyTo !== undefined) lines.push(`Replying to ${replyTo}`, '');
  if (index === 0) lines.push(`**${thread.title}**`, '');
  const text = bodyMarkdown(post, thread.origin);
  if (text) lines.push(text, '');
  lines.push(
    `Source: ${thread.url}/${post.post_number}`,
    `Date: ${post.created_at}`,
  );
  return lines.join('\n');
}

/** `Name (@username)`, or `@username` alone for an account without a name
 *  or one whose name only repeats the username. */
function authorOf(post: Post): string {
  if (post.username === null) return '[deleted]';
  const name = post.name?.trim();
  return name && name.toLowerCase() !== post.username.toLowerCase()
    ? `${name} (@${post.username})`
    : `@${post.username}`;
}

/** Who a reply answers. A reply to the opening post, the thread's subject,
 *  names no one, and a target that did not load is named by its number. */
function replyTarget(
  post: Post,
  authors: ReadonlyMap<number, string | null>,
): string | undefined {
  const number = post.reply_to_post_number;
  if (number === null || number === 1) return undefined;
  const username = authors.get(number);
  return username ? `@${username}` : `post #${number}`;
}

/** Posts link within the forum root-relatively (`/u/alice`, `/uploads/…`),
 *  which means nothing outside it. A small action with no text renders its
 *  event name. */
function bodyMarkdown(post: Post, origin: string): string {
  const html = post.cooked
    .replaceAll(EMPTY_ANCHOR, '')
    .replaceAll(LINK_TAG, (tag) =>
      tag.replaceAll(
        ROOT_RELATIVE,
        (_match, attribute: string) => `${attribute}="${origin}/`,
      ),
    );
  const text = convertToMarkdown(html).trim();
  if (text) return text;
  return post.action_code === null ? '' : `\`${post.action_code}\``;
}
