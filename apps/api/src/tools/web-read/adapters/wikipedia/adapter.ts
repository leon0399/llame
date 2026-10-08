import { parseHTML } from 'linkedom';

import type { WikipediaWebAdapterConfig } from '../../../../instance-config/llame-config';
import { convertToMarkdown } from '../../pipeline';
import { primaryFailure, type WebAdapter } from '../contract';

/** `{lang}.wikipedia.org` or its mobile `{lang}.m.wikipedia.org`. */
const ARTICLE_HOST = /^([a-z][a-z-]{1,15})(?:\.m)?\.wikipedia\.org$/u;
const ARTICLE_PATH = /^\/wiki\/([^/]+)$/u;
/** English namespaces whose pages are not articles. */
const NAMESPACE =
  /^(?:Special|Media|File|Image|Talk|User|User_talk|Wikipedia|Wikipedia_talk|File_talk|MediaWiki|MediaWiki_talk|Template|Template_talk|Help|Help_talk|Category|Category_talk|Portal|Portal_talk|Draft|Draft_talk|Module|Module_talk|TimedText|TimedText_talk):/iu;
/** What a reader of the article text does not need: citation markers and
 *  lists, edit links, navigation boxes, maintenance notices, the infobox
 *  table, and media, down to the inline icons links carry. */
const NOISE = [
  'style',
  'link',
  'sup.reference',
  '.mw-editsection',
  '.mw-references-wrap',
  '.reflist',
  '.navbox',
  '.navbox-styles',
  '.hatnote',
  '.ambox',
  '.metadata',
  '.noprint',
  '.infobox',
  '.sidebar',
  '.shortdescription',
  '.mw-empty-elt',
  'figure',
  'img',
].join(',');

type WikipediaTarget = { readonly origin: string; readonly title: string };

/** Matches an article on a language edition of Wikipedia. */
export function parseWikipediaUrl(source: URL): WikipediaTarget | undefined {
  const lang = ARTICLE_HOST.exec(source.host)?.[1];
  const title = ARTICLE_PATH.exec(source.pathname)?.[1];
  if (source.protocol !== 'https:' || lang === undefined || !title) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(title);
  } catch {
    return undefined;
  }
  return NAMESPACE.test(decoded)
    ? undefined
    : { origin: `https://${lang}.wikipedia.org`, title: decoded };
}

/** Creates the native Wikipedia adapter. */
export function createWikipediaAdapter(
  config: WikipediaWebAdapterConfig,
): WebAdapter {
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseWikipediaUrl(source) !== undefined,
    read: async (source, io) => {
      const target = parseWikipediaUrl(source)!;
      // A redirect title answers 307 to its target's page, followed like
      // any same-origin hop.
      const fetched = await io.fetch(
        `${target.origin}/w/rest.php/v1/page/${encodeURIComponent(target.title)}/html`,
        { accept: 'text/html' },
      );
      if ('type' in fetched) return primaryFailure(fetched);
      const content = renderArticle(fetched.body, target.origin);
      return content === undefined
        ? { kind: 'failed', failure: 'empty' }
        : { kind: 'rendered', content, mediaType: 'text/markdown', notes: [] };
    },
  };
}

/** Parsoid HTML with the noise removed, code kept as code, and links made
 *  absolute without their tooltip titles. */
function renderArticle(html: string, origin: string): string | undefined {
  const { document } = parseHTML(html);
  const title = document.querySelector('title')?.textContent ?? '';
  for (const node of document.querySelectorAll(NOISE)) node.remove();
  for (const pre of document.querySelectorAll('pre')) {
    const code = document.createElement('code');
    code.textContent = pre.textContent;
    pre.replaceChildren(code);
  }
  for (const link of document.querySelectorAll('a')) {
    link.removeAttribute('title');
    const href = link.getAttribute('href');
    if (href?.startsWith('./')) {
      link.setAttribute('href', `${origin}/wiki/${href.slice(2)}`);
    }
  }
  const body = convertToMarkdown(document.body.innerHTML).trim();
  if (!body) return undefined;
  const url = `${origin}/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
  return [`# ${title}`, '', `URL: ${url}`, '', body].join('\n');
}
