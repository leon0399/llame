import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import type { WebResponse } from './http-client';

export type WebRenderMethod = 'negotiated' | 'readability' | 'text' | 'raw';

export type WebRender = {
  readonly method: WebRenderMethod;
  readonly content: string;
  readonly notes?: ReadonlyArray<string>;
};

/** More non-whitespace characters than this is content rather than a stub. */
const MIN_CONTENT_CHARS = 100;

/** Under this length, one of `CHALLENGE_PHRASES` marks an interstitial. */
const CHALLENGE_MAX_CHARS = 1024;

const SHORT_LINE_CHARS = 40;
const SHORT_LINE_RATIO = 0.7;

const CONVERSION_NOTE =
  'The page could not be converted to Markdown; the response body is returned unchanged.';

/**
 * A body that carries one of these under `CHALLENGE_MAX_CHARS` is a JavaScript
 * or captcha gate rather than page text, so the gate refuses to convert it.
 */
const CHALLENGE_PHRASES = [
  'enable javascript',
  'javascript is disabled',
  'checking your browser',
  'verify you are human',
  'captcha',
  'just a moment',
] as const;

/** A body whose first non-whitespace character opens a tag is treated as markup. */
const HTML_MARKUP_START = /^\s*<[a-z!/?]/i;

const EMPTY_BODY = /^\s*$/;

/**
 * Renders the body of a response the HTTP client already vetted as text.
 * `raw` skips every conversion; otherwise a publisher Markdown or plain-text
 * body wins as served, an HTML body is rendered locally, and any other text
 * body (JSON, XML, other `text/*`) is returned unchanged.
 */
export function renderWebDocument(
  response: WebResponse,
  options: { readonly raw: boolean },
): WebRender {
  if (options.raw) return { method: 'raw', content: response.body };

  // The client lowercases the media type but keeps the header's parameters.
  const mediaType = response.contentType.split(';', 1)[0].trim().toLowerCase();
  if (mediaType === 'text/markdown') {
    return { method: 'negotiated', content: response.body };
  }
  if (mediaType === 'text/plain' && !HTML_MARKUP_START.test(response.body)) {
    return { method: 'negotiated', content: response.body };
  }
  // `application/xhtml+xml` is HTML, and so is a `text/plain` body shaped like
  // markup; every other accepted type — JSON, XML (including a `+xml` suffix),
  // and other `text/*` — is returned unchanged as text.
  if (
    mediaType === 'text/html' ||
    mediaType === 'application/xhtml+xml' ||
    (mediaType === 'text/plain' && HTML_MARKUP_START.test(response.body))
  ) {
    return renderHtmlBody(response);
  }

  return { method: 'text', content: response.body };
}

/**
 * Judges converted text: a stub, or a low-quality body, is not content the
 * tool may present as the page.
 */
export function passesQualityGate(text: string): boolean {
  if (text.replaceAll(/\s+/g, '').length <= MIN_CONTENT_CHARS) return false;

  return !isLowQuality(text);
}

function renderHtmlBody(response: WebResponse): WebRender {
  // linkedom cannot build a document from an empty body, and there is nothing
  // to convert, so the raw fallback is taken without parsing.
  if (EMPTY_BODY.test(response.body)) return unconverted(response, '');

  const page = parseWebDocument(response.body, response.finalUrl);
  const article = new Readability(page.document).parse();
  const converted = convertToMarkdown(article?.content ?? page.bodyHtml);
  if (passesQualityGate(converted)) {
    return { method: 'readability', content: converted };
  }

  return unconverted(response, converted);
}

/** The response body as served, with the note explaining why it is not converted. */
function unconverted(response: WebResponse, converted: string): WebRender {
  const challenge =
    findChallengePhrase(converted) ?? findChallengePhrase(response.body);
  if (challenge === undefined) {
    return { method: 'raw', content: response.body, notes: [CONVERSION_NOTE] };
  }

  return {
    method: 'raw',
    content: response.body,
    notes: [
      CONVERSION_NOTE,
      `A JavaScript or captcha challenge was detected (${challenge}), so the page was not converted.`,
    ],
  };
}

type ParsedWebDocument = {
  readonly document: Document;
  readonly bodyHtml: string;
};

/**
 * linkedom does not normalise a bare fragment into `html`/`body` and Readability
 * needs both, so a document that came back without an `html` root or with an
 * empty body is re-parsed inside a wrapper. Readability mutates the document it
 * is given, so the body HTML for the whole-body fallback is captured first.
 */
function parseWebDocument(html: string, baseHref: string): ParsedWebDocument {
  let document = parseHTML(html).document;
  if (
    document.documentElement.tagName !== 'HTML' ||
    document.body.childElementCount === 0
  ) {
    document = parseHTML(
      `<!doctype html><html><head></head><body>${html}</body></html>`,
    ).document;
  }

  // Without a base, linkedom's `document.baseURI` is null and Readability
  // leaves every relative link relative.
  const base = document.createElement('base');
  base.setAttribute('href', baseHref);
  document.head.prepend(base);

  return { document, bodyHtml: document.body.innerHTML };
}

function convertToMarkdown(html: string): string {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  service.use(gfm);

  return service.turndown(html);
}

function isLowQuality(text: string): boolean {
  const trimmed = text.trim();
  if (
    trimmed.length < CHALLENGE_MAX_CHARS &&
    findChallengePhrase(trimmed) !== undefined
  ) {
    return true;
  }

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return false;

  const shortLines = lines.filter(
    (line) => line.trim().length < SHORT_LINE_CHARS,
  ).length;

  return shortLines / lines.length > SHORT_LINE_RATIO;
}

function findChallengePhrase(text: string): string | undefined {
  const lowered = text.toLowerCase();

  return CHALLENGE_PHRASES.find((phrase) => lowered.includes(phrase));
}
