import { z } from 'zod';

import type { SubstackWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebRequestInit } from '../../http-client';
import { convertToMarkdown } from '../../pipeline';
import { parseJsonBody, primaryFailure, type WebAdapter } from '../contract';

const JSON_INIT: WebRequestInit = { accept: 'application/json' };

/** A publication's own subdomain; `www` is not one. A publication on a custom
 *  domain is not claimed, but its `substack.com` address redirects there. */
const PUBLICATION_HOST = /^(?!www\.)[a-z0-9][a-z0-9-]*\.substack\.com$/u;
const POST_PATH = /^\/p\/([\w-]+)\/?$/u;

/** The link Substack puts around each image to its full-size file on the
 *  image CDN, which would render the image twice: `[![](small)](full)`. A
 *  link the author gave an image has the same class but another `href`, and
 *  stays. */
const IMAGE_LINK =
  /<a\b(?=[^>]*\sclass="[^"]*\bimage-link\b)(?=[^>]*\shref="https:\/\/substackcdn\.com\/image\/)[^>]*>([\s\S]*?)<\/a>/gu;
/** A root-relative `href` or `src` on a tag. Only markup matches, since body
 *  text escapes `<`, so a code sample showing one is left alone. */
const ROOT_RELATIVE = /(<[a-z][^>]*?\s(?:href|src)=")\/(?!\/)/gu;

/** `GET /api/v1/posts/{slug}`. `audience` is `everyone` only for a free post;
 *  a byline without a name and a hidden tag are not shown. */
const POST = z.object({
  title: z.string(),
  subtitle: z.string().nullish(),
  audience: z.string(),
  canonical_url: z.string(),
  post_date: z.string().nullish(),
  body_html: z.string().nullish(),
  publishedBylines: z
    .array(z.object({ name: z.string().nullish() }))
    .default([]),
  postTags: z
    .array(z.object({ name: z.string(), hidden: z.boolean().nullish() }))
    .default([]),
});
type Post = z.infer<typeof POST>;

/** Matches `{publication}.substack.com/p/{slug}`, also with a trailing `/`. */
export function parseSubstackUrl(source: URL): string | undefined {
  if (source.protocol !== 'https:' || !PUBLICATION_HOST.test(source.host)) {
    return undefined;
  }
  return POST_PATH.exec(source.pathname)?.[1];
}

/** Creates the native Substack adapter. */
export function createSubstackAdapter(
  config: SubstackWebAdapterConfig,
): WebAdapter {
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseSubstackUrl(source) !== undefined,
    read: async (source, io) => {
      const fetched = await io.fetch(
        `${source.origin}/api/v1/posts/${parseSubstackUrl(source)!}`,
        JSON_INIT,
      );
      if ('type' in fetched) return primaryFailure(fetched);
      const post = parseJsonBody(fetched.body, POST);
      if (post === undefined) return { kind: 'failed', failure: 'parse' };
      const body = bodyMarkdown(post.body_html ?? '', source.origin);
      if (!body) return { kind: 'failed', failure: 'empty' };
      return {
        kind: 'rendered',
        content: renderPost(post, body),
        mediaType: 'text/markdown',
        // A paid post's API body is its free preview.
        notes:
          post.audience === 'everyone' ? [] : ['body truncated: paid post'],
      };
    },
  };
}

function renderPost(post: Post, body: string): string {
  const authors = post.publishedBylines.flatMap(({ name }) =>
    name ? [name] : [],
  );
  const tags = post.postTags.flatMap((tag) =>
    tag.hidden === true ? [] : [tag.name],
  );
  const fields: Array<[string, string | null | undefined]> = [
    ['Author', authors.join(', ')],
    ['Published', post.post_date],
    ['Tags', tags.join(', ')],
    ['URL', post.canonical_url],
  ];
  const lines = [`# ${post.title}`, ''];
  if (post.subtitle) lines.push(post.subtitle, '');
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push('', body);
  return lines.join('\n');
}

/** The post body converted to Markdown, its root-relative links resolved
 *  against the publication. */
function bodyMarkdown(html: string, origin: string): string {
  return convertToMarkdown(
    html.replaceAll(IMAGE_LINK, '$1').replaceAll(ROOT_RELATIVE, `$1${origin}/`),
  ).trim();
}
