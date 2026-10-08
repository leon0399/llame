import { z } from 'zod';

/**
 * The self-label an account sets to ask clients not to show it to logged-out
 * viewers. The public AppView still serves such accounts, so the adapter
 * withholds them the way bsky.app does for a reader without a session.
 */
const NO_UNAUTHENTICATED = '!no-unauthenticated';
const WEB_ORIGIN = 'https://bsky.app';
const INVALID_HANDLE = 'handle.invalid';
const LINK_FEATURE = 'app.bsky.richtext.facet#link';
/** `#viewRecord`, `#viewNotFound`, `#viewBlocked`, and `#viewDetached` are
 *  quoted-post views; any other `$type` is a feed, list, or similar record. */
const QUOTED_POST_VIEW = 'app.bsky.embed.record#view';
const UNAVAILABLE_QUOTE = ['**Quoted post**', '', 'Unavailable'];

export type BlueskyRender =
  | { readonly content: string }
  | { readonly failure: 'parse' | 'empty' };

/** An embed already reduced to the lines x.md renders for it. */
type EmbedParts = {
  /** Media lines without their blockquote prefix. */
  readonly media: ReadonlyArray<string>;
  /** The quoted record's block body without its blockquote prefix. */
  readonly quote?: ReadonlyArray<string>;
};

type ThreadNode = {
  readonly post: BlueskyPost;
  readonly parent: ThreadNode | undefined;
  readonly replies: ReadonlyArray<ThreadNode>;
};

type ThreadEntry = {
  readonly label: 'Parent' | 'Post' | 'Thread' | 'Reply';
  readonly post: BlueskyPost;
  /** Set when the post answers someone other than the focal post. */
  readonly replyTo?: string;
};

/** Parses to `undefined` instead of failing, so one malformed or unknown
 *  element is skipped rather than failing the read. */
const SKIPPED = z.unknown().transform(() => undefined);

const AUTHOR = z.object({
  did: z.string(),
  handle: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  labels: z
    .array(z.object({ src: z.string().optional(), val: z.string() }))
    .optional(),
});
type Author = z.infer<typeof AUTHOR>;

const FACETS = z.array(
  z.object({
    index: z.object({
      byteStart: z.number().int(),
      byteEnd: z.number().int(),
    }),
    features: z.array(
      z.object({ $type: z.string(), uri: z.string().optional() }),
    ),
  }),
);
type Facets = z.infer<typeof FACETS>;

/** A post record with link facets already expanded into its text; a
 *  malformed facet array is ignored rather than failing the post. */
const POST_RECORD = z
  .object({
    text: z.string().default(''),
    facets: z.unknown().optional(),
    createdAt: z.string().optional(),
  })
  .transform(({ text, facets, createdAt }) => ({
    text: expandLinks(text, FACETS.safeParse(facets).data ?? []),
    createdAt,
  }));

const IMAGE = z.object({ fullsize: z.string(), alt: z.string().optional() });
const VIDEO = z.object({
  playlist: z.string(),
  thumbnail: z.string().optional(),
});
const EXTERNAL = z.object({
  uri: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
});

/** The media embed views, as their lines without a blockquote prefix. */
const MEDIA = z.union([
  z
    .object({
      $type: z.literal('app.bsky.embed.images#view'),
      images: z.array(IMAGE),
    })
    .transform(({ images }) => images.map(imageLine)),
  z
    .object({
      $type: z.literal('app.bsky.embed.gallery#view'),
      items: z.array(
        z.union([
          IMAGE.transform((image) => [imageLine(image)]),
          VIDEO.transform(videoLines),
          SKIPPED.transform(() => []),
        ]),
      ),
    })
    .transform(({ items }) => items.flat()),
  VIDEO.extend({ $type: z.literal('app.bsky.embed.video#view') }).transform(
    videoLines,
  ),
  z
    .object({
      $type: z.literal('app.bsky.embed.external#view'),
      external: EXTERNAL,
    })
    .transform(({ external }) => externalLines(external)),
]);

/** Every hydrated embed view; an unknown or malformed one renders nothing,
 *  so a new AppView embed never fails the read. */
const EMBED: z.ZodType<EmbedParts> = z.lazy(() =>
  z.union([
    MEDIA.transform((media) => ({ media })),
    z
      .object({
        $type: z.literal('app.bsky.embed.record#view'),
        record: QUOTE,
      })
      .transform(({ record }) => ({ media: [], quote: record })),
    z
      .object({
        $type: z.literal('app.bsky.embed.recordWithMedia#view'),
        media: MEDIA.or(SKIPPED.transform(() => [])),
        record: z.object({ record: QUOTE }),
      })
      .transform(({ media, record }) => ({ media, quote: record.record })),
    SKIPPED.transform(() => ({ media: [] })),
  ]),
);

/** A quoted record's block body, in x.md's quoted-post layout. */
const QUOTE: z.ZodType<ReadonlyArray<string>> = z.lazy(() =>
  z.union([
    z
      .object({
        $type: z.literal('app.bsky.embed.record#viewRecord'),
        uri: z.string(),
        author: AUTHOR,
        value: POST_RECORD,
        embeds: z.array(EMBED).optional(),
      })
      .transform(quoteLines),
    z
      .object({ $type: z.string(), uri: z.string() })
      .transform(({ $type, uri }) =>
        $type.startsWith(QUOTED_POST_VIEW)
          ? UNAVAILABLE_QUOTE
          : ['**Embedded record**', '', uri],
      ),
    SKIPPED.transform(() => UNAVAILABLE_QUOTE),
  ]),
);

const POST_VIEW = z.object({
  uri: z.string(),
  author: AUTHOR,
  record: POST_RECORD,
  embed: EMBED.optional(),
});
export type BlueskyPost = z.infer<typeof POST_VIEW>;

/** Not-found and blocked nodes, and malformed ones, parse to `undefined`. */
const THREAD_NODE: z.ZodType<ThreadNode | undefined> = z.lazy(() =>
  z.union([
    z
      .object({
        $type: z.literal('app.bsky.feed.defs#threadViewPost'),
        post: POST_VIEW,
        parent: THREAD_NODE.optional(),
        replies: z.array(THREAD_NODE).optional(),
      })
      .transform(({ post, parent, replies = [] }) => ({
        post,
        parent,
        replies: replies.filter((reply) => reply !== undefined),
      })),
    SKIPPED,
  ]),
);

const PROFILE = AUTHOR.extend({
  followersCount: z.number().int().optional(),
  followsCount: z.number().int().optional(),
  postsCount: z.number().int().optional(),
});
export type BlueskyProfile = z.infer<typeof PROFILE>;

/** Reposts carry a `reason` and are dropped, as x.md lists originals. */
const AUTHOR_FEED = z.object({
  feed: z.array(
    z
      .object({ post: POST_VIEW, reason: z.unknown().optional() })
      .transform(({ post, reason }) =>
        reason === undefined ? post : undefined,
      )
      .or(SKIPPED),
  ),
});

const ACCOUNTS = z.array(AUTHOR.or(SKIPPED)).optional();
const FOLLOW_PAGE = z.object({
  subject: AUTHOR,
  followers: ACCOUNTS,
  follows: ACCOUNTS,
  cursor: z.string().optional(),
});

/** Renders `app.bsky.feed.getPostThread` in x.md's thread layout. */
export function renderThread(body: string): BlueskyRender {
  const thread = parseJson(body, z.object({ thread: THREAD_NODE }));
  if (thread === undefined) return { failure: 'parse' };
  const focal = thread.thread;
  if (focal === undefined || isHidden(focal.post.author)) {
    return { failure: 'empty' };
  }

  const entries: Array<ThreadEntry> = [];
  for (
    let ancestor = focal.parent;
    ancestor !== undefined && !isHidden(ancestor.post.author);
    ancestor = ancestor.parent
  ) {
    entries.unshift({ label: 'Parent', post: ancestor.post });
  }
  entries.push({ label: 'Post', post: focal.post });
  collectReplies(focal, focal.post, true, entries);

  const content = entries
    .map((entry, index) => postLines(entry, index, entries.length).join('\n'))
    .join('\n\n---\n\n');
  return { content };
}

/** Parses `app.bsky.actor.getProfile`; a withheld account is `empty`. */
export function parseProfile(
  body: string,
):
  | { readonly profile: BlueskyProfile }
  | { readonly failure: 'parse' | 'empty' } {
  const profile = parseJson(body, PROFILE);
  if (profile === undefined) return { failure: 'parse' };
  return isHidden(profile) ? { failure: 'empty' } : { profile };
}

/** Parses `app.bsky.feed.getAuthorFeed` into the author's own posts. */
export function parseAuthorFeed(
  body: string,
): ReadonlyArray<BlueskyPost> | undefined {
  return parseJson(body, AUTHOR_FEED)?.feed.flatMap((post) =>
    post === undefined || isHidden(post.author) ? [] : [post],
  );
}

/** Renders a profile; `posts` is undefined when the feed did not load. */
export function renderProfile(
  profile: BlueskyProfile,
  posts: ReadonlyArray<BlueskyPost> | undefined,
): string {
  const lines = [`# [${authorLabel(profile)}](${profileUrl(profile)})`, ''];
  const description = profile.description?.trim();
  if (description) lines.push(description, '');
  lines.push(
    `Followers: ${formatCount(profile.followersCount)} · Following: ${formatCount(profile.followsCount)} · Posts: ${formatCount(profile.postsCount)}`,
  );
  if (posts === undefined) return lines.join('\n');

  lines.push('', '## Latest posts');
  if (posts.length === 0)
    lines.push('', 'No original posts among the latest 30.');
  for (const post of posts) {
    lines.push(
      `- [@${post.author.handle}](${profileUrl(post.author)}): ${oneLine(post.record.text)} [Source](${postUrl(post.author, post.uri)})`,
    );
  }
  return lines.join('\n');
}

/** Renders `app.bsky.graph.getFollowers` or `app.bsky.graph.getFollows`. */
export function renderFollowList(
  body: string,
  list: 'followers' | 'follows',
): BlueskyRender {
  const page = parseJson(body, FOLLOW_PAGE);
  const accounts = page?.[list];
  if (page === undefined || accounts === undefined) {
    return { failure: 'parse' };
  }
  if (isHidden(page.subject)) return { failure: 'empty' };

  const title = list === 'followers' ? 'Followers of' : 'Accounts followed by';
  const lines = [
    `# ${title} [${authorLabel(page.subject)}](${profileUrl(page.subject)})`,
    '',
  ];
  const listed = accounts.flatMap((account) => {
    if (account === undefined || isHidden(account)) return [];
    const bio = oneLine(account.description ?? '');
    return [
      `- [${authorLabel(account)}](${profileUrl(account)})${bio ? `: ${bio}` : ''}`,
    ];
  });
  lines.push(...(listed.length === 0 ? ['No accounts.'] : listed));
  if (page.cursor !== undefined) {
    lines.push('', `Showing the first ${listed.length}; more are not loaded.`);
  }
  return { content: lines.join('\n') };
}

/** Depth-first in AppView order. A reply stays `Thread` while the focal
 *  author answers their own chain, as x.md labels a self-thread. */
function collectReplies(
  node: ThreadNode,
  focal: BlueskyPost,
  selfThread: boolean,
  entries: Array<ThreadEntry>,
): void {
  for (const child of node.replies) {
    if (isHidden(child.post.author)) continue;
    const thread = selfThread && child.post.author.did === focal.author.did;
    entries.push({
      label: thread ? 'Thread' : 'Reply',
      post: child.post,
      ...(node.post.uri !== focal.uri && {
        replyTo: node.post.author.handle,
      }),
    });
    collectReplies(child, focal, thread, entries);
  }
}

function postLines(
  entry: ThreadEntry,
  index: number,
  total: number,
): Array<string> {
  const { post } = entry;
  const lines = [
    `## ${entry.label} · ${index + 1}/${total} — ${authorLabel(post.author)}`,
    '',
  ];
  if (entry.replyTo !== undefined) {
    lines.push(`Replying to @${entry.replyTo}`, '');
  }
  const text = post.record.text.trim();
  if (text) lines.push(text, '');
  const media = post.embed?.media ?? [];
  if (media.length > 0) lines.push(...media.map(blockquote), '');
  const quote = post.embed?.quote;
  if (quote !== undefined) lines.push(...quote.map(blockquote), '');
  lines.push(`Source: ${postUrl(post.author, post.uri)}`);
  if (post.record.createdAt !== undefined) {
    lines.push(`Date: ${post.record.createdAt}`);
  }
  return lines;
}

/** Media sits one level inside the quote block, a nested quote one deeper. */
function quoteLines(quoted: {
  readonly uri: string;
  readonly author: Author;
  readonly value: { readonly text: string };
  readonly embeds?: ReadonlyArray<EmbedParts>;
}): ReadonlyArray<string> {
  const { author, value, embeds = [] } = quoted;
  if (isHidden(author)) return UNAVAILABLE_QUOTE;
  const name = author.displayName?.trim() || author.handle;
  const lines = ['**Quoted post**', '', `**${name}** @${author.handle}`];
  const text = value.text.trim();
  if (text) lines.push(...text.split('\n'));
  for (const embed of embeds) {
    lines.push(...embed.media, ...(embed.quote ?? []).map(blockquote));
  }
  lines.push(`Source: ${postUrl(author, quoted.uri)}`);
  return lines;
}

function imageLine(image: z.infer<typeof IMAGE>): string {
  const alt = oneLine(image.alt ?? '').replaceAll(/[[\]]/gu, '');
  return `![${alt || 'image'}](${image.fullsize})`;
}

function videoLines(video: z.infer<typeof VIDEO>): Array<string> {
  return video.thumbnail === undefined
    ? [`[video](${video.playlist})`]
    : [`[video](${video.playlist})`, `![video thumbnail](${video.thumbnail})`];
}

function externalLines(external: z.infer<typeof EXTERNAL>): Array<string> {
  const title = oneLine(external.title ?? '') || external.uri;
  const description = oneLine(external.description ?? '');
  return description
    ? [`[${title}](${external.uri})`, description]
    : [`[${title}](${external.uri})`];
}

/** Replaces each link facet's shortened display text with a Markdown link to
 *  its full URI; facet offsets are UTF-8 byte offsets. */
function expandLinks(text: string, facets: Facets): string {
  const bytes = Buffer.from(text, 'utf8');
  const links = facets
    .flatMap(({ index, features }) => {
      const uri = features.find(({ $type }) => $type === LINK_FEATURE)?.uri;
      return uri === undefined ? [] : [{ ...index, uri }];
    })
    .sort((left, right) => left.byteStart - right.byteStart);

  let expanded = '';
  let cursor = 0;
  for (const { byteStart, byteEnd, uri } of links) {
    if (byteStart < cursor || byteEnd > bytes.length || byteEnd <= byteStart) {
      continue;
    }
    const label = bytes.subarray(byteStart, byteEnd).toString('utf8');
    expanded += bytes.subarray(cursor, byteStart).toString('utf8');
    expanded += label === uri ? uri : `[${label}](${uri})`;
    cursor = byteEnd;
  }
  return expanded + bytes.subarray(cursor).toString('utf8');
}

function formatCount(value: number | undefined): string {
  return (value ?? 0).toLocaleString('en-US');
}

/** Only the account's own label counts, as in bsky.app: any labeler can
 *  emit the value against any account. */
function isHidden(author: Author): boolean {
  return (author.labels ?? []).some(
    ({ src, val }) => val === NO_UNAUTHENTICATED && src === author.did,
  );
}

function authorLabel(author: Author): string {
  const name = author.displayName?.trim();
  return name ? `${name} (@${author.handle})` : `@${author.handle}`;
}

function profileUrl(author: Author): string {
  const actor = author.handle === INVALID_HANDLE ? author.did : author.handle;
  return `${WEB_ORIGIN}/profile/${actor}`;
}

/** An `at://{did}/app.bsky.feed.post/{rkey}` URI's bsky.app permalink. */
function postUrl(author: Author, uri: string): string {
  return `${profileUrl(author)}/post/${uri.slice(uri.lastIndexOf('/') + 1)}`;
}

function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function blockquote(line: string): string {
  return line === '' ? '>' : `> ${line}`;
}

function parseJson<T>(body: string, schema: z.ZodType<T>): T | undefined {
  try {
    return schema.safeParse(JSON.parse(body)).data;
  } catch {
    return undefined;
  }
}
