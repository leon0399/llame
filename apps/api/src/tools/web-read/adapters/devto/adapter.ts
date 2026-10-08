import { z } from 'zod';

import type { DevtoWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebRequestInit } from '../../http-client';
import { parseJsonBody, primaryFailure, type WebAdapter } from '../contract';

type DevtoTarget = { readonly username: string; readonly slug: string };

const JSON_INIT: WebRequestInit = { accept: 'application/json' };

/** An article is `/{username}/{slug}`. Accounts and organizations take names
 *  of two to 30 characters, so a one-letter prefix such as `/t/{tag}` or
 *  `/p/{page}` is a site page. */
const ARTICLE_PATH = /^\/([\w-]{2,})\/([\w-]+)\/?$/u;

/** dev.to's own pages that take a second segment (`/top/week`,
 *  `/tag/{tag}`, `/api/articles`). Forem routes them before articles and,
 *  except `page`, reserves them as account names, so no article lives under
 *  one. */
const SITE_PAGES = {
  admin: true,
  api: true,
  dashboard: true,
  feed: true,
  new: true,
  notifications: true,
  page: true,
  readinglist: true,
  search: true,
  settings: true,
  tag: true,
  top: true,
  users: true,
} as const satisfies Readonly<Record<string, true>>;

/** The single-article endpoint sends `tags` as an array and `tag_list` as one
 *  comma-separated string; the listing endpoints swap the two. */
const ARTICLE = z.object({
  title: z.string(),
  description: z.string().nullish(),
  url: z.string(),
  published_at: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  body_markdown: z.string(),
  user: z.object({ name: z.string() }),
});
type Article = z.infer<typeof ARTICLE>;

/** Matches `dev.to/{username}/{slug}`; profiles, tag pages, search, and
 *  other site pages are not articles. */
export function parseDevtoUrl(source: URL): DevtoTarget | undefined {
  if (source.protocol !== 'https:' || source.host !== 'dev.to') {
    return undefined;
  }
  const match = ARTICLE_PATH.exec(source.pathname);
  if (match === null) return undefined;
  const [, username, slug] = match;
  // `/{username}/series` is the profile's series index, not an article.
  return Object.hasOwn(SITE_PAGES, username) || slug === 'series'
    ? undefined
    : { username, slug };
}

/** Creates the native dev.to adapter. */
export function createDevtoAdapter(config: DevtoWebAdapterConfig): WebAdapter {
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseDevtoUrl(source) !== undefined,
    read: async (source, io) => {
      const { username, slug } = parseDevtoUrl(source)!;
      const fetched = await io.fetch(
        `${source.origin}/api/articles/${username}/${slug}`,
        JSON_INIT,
      );
      if ('type' in fetched) return primaryFailure(fetched);
      const article = parseJsonBody(fetched.body, ARTICLE);
      if (article === undefined) return { kind: 'failed', failure: 'parse' };
      // Some articles are stored with CRLF line endings.
      const body = article.body_markdown.replaceAll('\r\n', '\n').trim();
      if (!body) return { kind: 'failed', failure: 'empty' };
      return {
        kind: 'rendered',
        content: renderArticle(article, body),
        mediaType: 'text/markdown',
        notes: [],
      };
    },
  };
}

function renderArticle(article: Article, body: string): string {
  // Unless the author wrote one, dev.to cuts the description from the body's
  // first characters, whitespace runs included.
  const description = article.description?.replaceAll(/\s+/gu, ' ').trim();
  const fields: Array<[string, string | null | undefined]> = [
    ['Author', article.user.name],
    ['Published', article.published_at],
    ['Tags', article.tags.join(', ')],
    ['URL', article.url],
  ];
  const lines = [`# ${article.title}`, ''];
  if (description) lines.push(description, '');
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push('', body);
  return lines.join('\n');
}
