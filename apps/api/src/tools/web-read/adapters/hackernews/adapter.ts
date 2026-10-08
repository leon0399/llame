import { z } from 'zod';

import type { HackernewsWebAdapterConfig } from '../../../../instance-config/llame-config';
import { convertToMarkdown } from '../../pipeline';
import { parseJsonBody, primaryFailure, type WebAdapter } from '../contract';

/** Algolia's Hacker News API serves an item with its whole reply tree in one
 *  keyless request. */
export const HACKERNEWS_API_ORIGIN = 'https://hn.algolia.com';
const ITEM_URL = 'https://news.ycombinator.com/item?id=';
const ITEM_ID = /^[1-9]\d{0,11}$/u;

type Item = {
  readonly id: number;
  readonly type: string;
  readonly author: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly text: string | null;
  readonly points: number | null;
  readonly created_at: string;
  readonly parent_id: number | null;
  readonly children: ReadonlyArray<Item>;
};

const ITEM: z.ZodType<Item> = z.lazy(() =>
  z.object({
    id: z.number().int(),
    type: z.string(),
    author: z.string().nullable(),
    title: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    url: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    text: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    points: z
      .number()
      .nullish()
      .transform((value) => value ?? null),
    created_at: z.string(),
    parent_id: z.number().int().nullable(),
    children: z.array(ITEM),
  }),
);

type Entry = {
  readonly label: 'Post' | 'Reply';
  readonly item: Item;
  /** Set when the item answers someone other than the requested item. */
  readonly replyTo?: string;
};

/** Matches `news.ycombinator.com/item?id={id}`; other query parameters, such
 *  as a comment page number, are ignored. */
export function parseHackernewsUrl(source: URL): string | undefined {
  if (
    source.protocol !== 'https:' ||
    source.host !== 'news.ycombinator.com' ||
    source.pathname !== '/item'
  ) {
    return undefined;
  }
  const id = source.searchParams.get('id');
  return id !== null && ITEM_ID.test(id) ? id : undefined;
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
      const fetched = await io.fetch(
        `${api}/api/v1/items/${parseHackernewsUrl(source)!}`,
        { accept: 'application/json' },
      );
      if ('type' in fetched) return primaryFailure(fetched);
      const item = parseJsonBody(fetched.body, ITEM);
      if (item === undefined) return { kind: 'failed', failure: 'parse' };
      return {
        kind: 'rendered',
        content: renderThread(item),
        mediaType: 'text/markdown',
        notes: [],
      };
    },
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
  const text =
    item.author === null
      ? '[deleted]'
      : convertToMarkdown(item.text ?? '').trim();
  if (text) lines.push(text, '');
  if (item.points !== null) lines.push(`Points: ${item.points}`);
  lines.push(`Source: ${ITEM_URL}${item.id}`, `Date: ${item.created_at}`);
  return lines.join('\n');
}

function authorOf(item: Item): string {
  return item.author === null ? '[deleted]' : `@${item.author}`;
}
