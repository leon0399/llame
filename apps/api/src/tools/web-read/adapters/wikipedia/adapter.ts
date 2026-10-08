import { parseHTML } from 'linkedom';

import type { WikipediaWebAdapterConfig } from '../../../../instance-config/llame-config';
import { convertToMarkdown } from '../../pipeline';
import { primaryFailure, type WebAdapter } from '../contract';

/** `{lang}.wikipedia.org` or its mobile `{lang}.m.wikipedia.org`. */
const ARTICLE_HOST = /^([a-z][a-z-]{1,15})(?:\.m)?\.wikipedia\.org$/u;
/** Main-namespace titles have no subpages, so a `/` is part of the title. */
const ARTICLE_PATH = /^\/wiki\/(.+)$/u;
/** A namespace prefix runs straight into its colon (`Talk:`, `Kategorie:`,
 *  `WP:`); an article title with a colon, such as `Star Wars: Episode IV`,
 *  follows it with a space. Namespace names differ by edition, so the shape is
 *  the test. */
const NAMESPACE = /^[^:]+:(?![_ ])/u;
/** What a reader of the article text does not need: citation markers and
 *  lists, navigation boxes, maintenance notices, the infobox table, hidden
 *  text, and images, down to the inline icons links carry. A figure's caption
 *  stays, since it often states facts the prose does not. */
const NOISE = [
  'style',
  'sup.reference',
  '.mw-ref',
  '.mw-references-wrap',
  '.mw-references',
  '.reflist',
  '.refbegin',
  '.navbox',
  '.hatnote',
  '.metadata',
  '.noprint',
  '.infobox',
  '.sidebar',
  '.mw-empty-elt',
  '[style*="display:none"]',
  '[style*="display: none"]',
  'img',
].join(',');

type WikipediaTarget = { readonly origin: string; readonly title: string };

/** Matches an article on a language edition of Wikipedia. */
export function parseWikipediaUrl(source: URL): WikipediaTarget | undefined {
  const lang = ARTICLE_HOST.exec(source.host)?.[1];
  const title = ARTICLE_PATH.exec(source.pathname)?.[1];
  // A query (`?oldid=`, `?diff=`, `?action=`) asks for another view.
  if (
    source.protocol !== 'https:' ||
    source.search !== '' ||
    lang === undefined ||
    title === undefined
  ) {
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

/** Parsoid HTML with the noise removed, formulas and code kept as code, and
 *  links made absolute without their tooltip titles. */
function renderArticle(html: string, origin: string): string | undefined {
  const { document } = parseHTML(html);
  const title = document.querySelector('title')?.textContent ?? '';
  // A formula's hidden MathML and fallback image both go with the noise; its
  // TeX source is what a reader can use.
  for (const math of document.querySelectorAll('.mwe-math-element')) {
    const code = document.createElement('code');
    code.textContent =
      math.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent ?? '';
    math.replaceWith(code);
  }
  for (const node of document.querySelectorAll(NOISE)) node.remove();
  for (const pre of document.querySelectorAll('pre')) {
    const code = document.createElement('code');
    code.textContent = pre.textContent;
    pre.replaceChildren(code);
  }
  for (const link of document.querySelectorAll('a')) {
    // A link whose only child was an image would render as `[](...)`.
    if (!link.textContent?.trim()) {
      link.remove();
      continue;
    }
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
