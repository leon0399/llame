import { z } from 'zod';

import type { HackernewsWebAdapterConfig } from '../../../../instance-config/llame-config';
import { convertToMarkdown } from '../../pipeline';
import {
  parseJsonBody,
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';

/** Algolia's Hacker News API serves an item with its whole reply tree, and a
 *  list page's stories, in one keyless request. */
export const HACKERNEWS_API_ORIGIN = 'https://hn.algolia.com';
const ITEM_URL = 'https://news.ycombinator.com/item?id=';
const ITEM_ID = /^[1-9]\d{0,11}$/u;
/** Reads only a list page's first 30 stories. */
const LIST_PAGE_SIZE = 30;

type Item = {
  readonly id: number;
  readonly type: string;
  readonly author: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly text: string | null;
  readonly points: number | null;
  readonly created_at: string;
  readonly children: ReadonlyArray<Item>;
};

/** The API omits dead and deleted comments with their replies, and sends a
 *  text-only job's `url` as an empty string. */
const ITEM: z.ZodType<Item> = z.lazy(() =>
  z.object({
    id: z.number().int(),
    type: z.string(),
    author: z.string().nullable().default(null),
    title: z.string().nullable().default(null),
    url: z
      .string()
      .nullable()
      .default(null)
      .transform((url) => url || null),
    text: z.string().nullable().default(null),
    points: z.number().nullable().default(null),
    created_at: z.string(),
    children: z.array(ITEM),
  }),
);

/** A story as the search endpoints report it. */
const STORY = z.object({
  objectID: z.string(),
  title: z.string(),
  url: z
    .string()
    .nullable()
    .default(null)
    .transform((url) => url || null),
  points: z.number().nullable().default(null),
  num_comments: z.number().nullable().default(null),
});
type Story = z.infer<typeof STORY>;
const SEARCH = z.object({ hits: z.array(STORY), nbHits: z.number() });

/** A story-list page and the Algolia query it maps to. */
type StoryList = {
  readonly heading: string;
  readonly endpoint: 'search' | 'search_by_date';
  readonly tags: string;
};

const FRONT_PAGE: StoryList = {
  heading: 'front page',
  endpoint: 'search',
  tags: 'front_page',
};

/** The list pages this adapter reads; every other path is unclaimed. */
const LISTS = {
  '/': FRONT_PAGE,
  '/news': FRONT_PAGE,
  '/front': FRONT_PAGE,
  '/newest': { heading: 'newest', endpoint: 'search_by_date', tags: 'story' },
} as const satisfies Record<string, StoryList>;

/** The item or list page a `news.ycombinator.com` locator names. */
type HackernewsTarget =
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'list'; readonly page: StoryList };

type Entry = {
  readonly label: 'Post' | 'Reply';
  readonly item: Item;
  /** Set when the item answers someone other than the requested item. */
  readonly replyTo?: string;
};

/** Matches `news.ycombinator.com/item?id={id}` and the list pages `/`,
 *  `/news`, `/front`, and `/newest`; other query parameters, such as a page
 *  number, are ignored. */
export function parseHackernewsUrl(source: URL): HackernewsTarget | undefined {
  if (source.protocol !== 'https:' || source.host !== 'news.ycombinator.com') {
    return undefined;
  }
  if (source.pathname === '/item') {
    const id = source.searchParams.get('id');
    return id !== null && ITEM_ID.test(id) ? { kind: 'item', id } : undefined;
  }
  for (const [path, page] of Object.entries(LISTS)) {
    if (path === source.pathname) return { kind: 'list', page };
  }
  return undefined;
}

/** Creates the native Hacker News adapter. */
export function createHackernewsAdapter(
  config: HackernewsWebAdapterConfig,
  options: { readonly apiOrigin?: string } = {},
): WebAdapter {
  const api = options.apiOrigin ?? HACKERNEWS_API_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseHackernewsUrl(source) !== undefined,
    read: async (source, io) => {
      const target = parseHackernewsUrl(source)!;
      return target.kind === 'item'
        ? readItem(target.id, api, io)
        : readList(target.page, api, io);
    },
  };
}

/** One request reads the item, or the list's first page. */
async function readItem(
  id: string,
  api: string,
  io: WebAdapterIo,
): Promise<WebAdapterOutcome> {
  const fetched = await io.fetch(`${api}/api/v1/items/${id}`, {
    accept: 'application/json',
  });
  if ('type' in fetched) return primaryFailure(fetched);
  const item = parseJsonBody(fetched.body, ITEM);
  // A poll's options arrive as bare ids and an option's text as null, so
  // either would render less than the page does.
  if (item === undefined || item.type === 'poll' || item.type === 'pollopt') {
    return { kind: 'failed', failure: 'parse' };
  }
  return {
    kind: 'rendered',
    content: renderThread(item),
    mediaType: 'text/markdown',
    notes: [],
  };
}

async function readList(
  page: StoryList,
  api: string,
  io: WebAdapterIo,
): Promise<WebAdapterOutcome> {
  const fetched = await io.fetch(
    `${api}/api/v1/${page.endpoint}?tags=${page.tags}&hitsPerPage=${LIST_PAGE_SIZE}`,
    { accept: 'application/json' },
  );
  if ('type' in fetched) return primaryFailure(fetched);
  const search = parseJsonBody(fetched.body, SEARCH);
  if (search === undefined) return { kind: 'failed', failure: 'parse' };
  return {
    kind: 'rendered',
    content: renderList(page, search.hits),
    mediaType: 'text/markdown',
    notes:
      search.nbHits > search.hits.length
        ? [`stories truncated: the first ${LIST_PAGE_SIZE} only`]
        : [],
  };
}

/** x.md's thread layout: the requested item, then every reply depth-first
 *  in the API's order, which is not Hacker News's ranking. */
function renderThread(focal: Item): string {
  const entries: Array<Entry> = [{ label: 'Post', item: focal }];
  const collect = (parent: Item): void => {
    for (const child of parent.children) {
      entries.push({
        label: 'Reply',
        item: child,
        ...(parent.id !== focal.id && { replyTo: authorOf(parent) }),
      });
      collect(child);
    }
  };
  collect(focal);
  return entries
    .map((entry, index) => entryLines(entry, `${index + 1}/${entries.length}`))
    .join('\n\n---\n\n');
}

function entryLines(entry: Entry, position: string): string {
  const { item } = entry;
  const lines = [`## ${entry.label} · ${position} — ${authorOf(item)}`, ''];
  if (entry.replyTo !== undefined) {
    lines.push(`Replying to ${entry.replyTo}`, '');
  }
  if (item.title !== null) lines.push(`**${item.title}**`, '');
  if (item.url !== null) lines.push(`Link: ${item.url}`, '');
  const text = convertToMarkdown(item.text ?? '').trim();
  if (text) lines.push(text, '');
  if (item.points !== null) lines.push(`Points: ${item.points}`);
  lines.push(`Source: ${ITEM_URL}${item.id}`, `Date: ${item.created_at}`);
  return lines.join('\n');
}

function authorOf(item: Item): string {
  return item.author === null ? '[deleted]' : `@${item.author}`;
}

/** A story list: one bullet per story, carrying its signal and its links. */
function renderList(page: StoryList, stories: ReadonlyArray<Story>): string {
  const lines = [`# Hacker News: ${page.heading}`, ''];
  if (stories.length === 0) lines.push('No stories.');
  for (const story of stories) {
    const fields = [
      `**${story.title}**`,
      story.points === null ? null : `${story.points} points`,
      story.num_comments === null ? null : `${story.num_comments} comments`,
      story.url,
      `${ITEM_URL}${story.objectID}`,
    ];
    lines.push(`- ${fields.filter(Boolean).join(' — ')}`);
  }
  return lines.join('\n');
}
