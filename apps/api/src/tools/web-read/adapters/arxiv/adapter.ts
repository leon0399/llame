import type { ArxivWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebResponse } from '../../http-client';
import { renderWebDocument } from '../../pipeline';
import {
  isFatalAdapterFailure,
  omissionNote,
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';

export const ARXIV_ORIGIN = 'https://arxiv.org';

/** A new-style id (`2412.09871`) or an old-style one (`hep-th/9901001`,
 *  `math.GT/0309136`), each with an optional version. */
const PAPER_ID = String.raw`(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d{1,3})?`;
const PAPER_PATH = new RegExp(
  `^/(?:abs|pdf|html)/(${PAPER_ID})(?:\\.pdf)?$`,
  'u',
);

/** LaTeXML's display-equation tables, one row per equation line. */
const EQUATION_TABLE =
  /<table\b[^>]*\bclass="[^"]*\bltx_eqn_table\b[^"]*"[^>]*>([\s\S]*?)<\/table>/gu;
const TABLE_ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gu;
const MATH_TEX = /<math\b[^>]*?\balttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gu;
const EQUATION_TAG =
  /<span\b[^>]*\bclass="ltx_tag ltx_tag_equation[^"]*"[^>]*>([^<]*)/u;

/** Matches `arxiv.org/abs|pdf|html/{id}`, versioned or not. */
export function parseArxivUrl(source: URL): string | undefined {
  if (
    source.protocol !== 'https:' ||
    (source.host !== 'arxiv.org' && source.host !== 'www.arxiv.org')
  ) {
    return undefined;
  }
  return PAPER_PATH.exec(source.pathname)?.[1];
}

/** Creates the native arXiv adapter. */
export function createArxivAdapter(
  config: ArxivWebAdapterConfig,
  options: { readonly origin?: string } = {},
): WebAdapter {
  const origin = options.origin ?? ARXIV_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseArxivUrl(source) !== undefined,
    read: (source, io) => readPaper(parseArxivUrl(source)!, io, origin),
  };
}

/**
 * The paper's HTML rendering is primary, so a `/pdf/` link reads as text.
 * When arXiv has no HTML for a version, the abstract page stands in with a
 * note, which still beats the generic ladder refusing the PDF.
 */
async function readPaper(
  id: string,
  io: WebAdapterIo,
  origin: string,
): Promise<WebAdapterOutcome> {
  const html = await io.fetch(`${origin}/html/${id}`);
  if (!('type' in html))
    return render({ ...html, body: texify(html.body) }, []);
  if (isFatalAdapterFailure(html)) return primaryFailure(html);

  const abstract = await io.fetch(`${origin}/abs/${id}`);
  if ('type' in abstract) return primaryFailure(abstract);
  return render(abstract, [omissionNote('full text', html)]);
}

function render(
  response: WebResponse,
  notes: ReadonlyArray<string>,
): WebAdapterOutcome {
  try {
    const rendered = renderWebDocument(response, { raw: false });
    return rendered.method === 'raw'
      ? { kind: 'failed', failure: 'parse' }
      : {
          kind: 'rendered',
          content: rendered.content,
          mediaType: rendered.mediaType,
          notes,
        };
  } catch {
    return { kind: 'failed', failure: 'parse' };
  }
}

/**
 * Replaces MathML with its LaTeX source before conversion, since the
 * Markdown converter keeps MathML as raw markup: a display equation becomes a
 * preformatted block of its lines and their numbers, inline math a code span.
 */
function texify(html: string): string {
  return html
    .replaceAll(EQUATION_TABLE, (_table, rows: string) => {
      const lines = [...rows.matchAll(TABLE_ROW)].flatMap(([, row = '']) => {
        const tex = [...row.matchAll(MATH_TEX)].map(([, source]) => source);
        const tag = EQUATION_TAG.exec(row)?.[1]?.trim();
        if (tex.length === 0) return [];
        return [tag ? `${tex.join(' ')}    ${tag}` : tex.join(' ')];
      });
      return `<pre><code>${lines.join('\n')}</code></pre>`;
    })
    .replaceAll(MATH_TEX, (_math, source: string) => `<code>${source}</code>`);
}
