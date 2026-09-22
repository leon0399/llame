import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import type { AdmitDerivedLocator, DerivedLocatorKind } from './admission';
import type { WebFetchFailure, WebResponse } from './http-client';

/** Every adapter a web read can report, in pipeline order. Declared as values
 *  so a caller can enumerate them; the union is derived from this list. */
export const WEB_RENDER_METHODS = [
  'negotiated',
  'alternate',
  'md-suffix',
  'readability',
  'llms-txt',
  'text',
  'raw',
] as const;

export type WebRenderMethod = (typeof WEB_RENDER_METHODS)[number];

export type WebRender = {
  readonly method: WebRenderMethod;
  readonly content: string;
  /** The final URL of the probe response that produced the content, present
   *  only when a probe won; a probe that followed redirects reports where it
   *  landed. A render of the page's own response carries none, because that
   *  response's URL is the call's `finalUrl` already. */
  readonly finalUrl?: string;
  readonly notes?: ReadonlyArray<string>;
};

/** One request of the call, bounded by the same client as the first. */
export type DerivedFetch = (
  url: string,
) => Promise<WebResponse | WebFetchFailure>;

export type WebPipelineDeps = {
  readonly fetch: DerivedFetch;
  readonly admit: AdmitDerivedLocator;
};

/** The kinds the pipeline derives itself; a hop is the hop loop's. */
type ProbeKind = Exclude<DerivedLocatorKind, 'hop'>;

/** The `method` a winning probe reports, which names the adapter that won. */
const PROBE_METHODS: Record<ProbeKind, WebRenderMethod> = {
  alternate: 'alternate',
  suffix: 'md-suffix',
  'llms-txt': 'llms-txt',
};

/** The three deepest scopes plus the site root: at most four `llms.txt`
 *  candidates per call. */
const MAX_LLMS_TXT_SCOPES = 3;

/** More non-whitespace characters than this is content rather than a stub. */
const MIN_CONTENT_CHARS = 100;

/** Under this length, one of `CHALLENGE_PHRASES` marks an interstitial. */
const CHALLENGE_MAX_CHARS = 1024;

const SHORT_LINE_CHARS = 40;
const SHORT_LINE_RATIO = 0.7;
/**
 * The short-line ratio judges shape, which is the whole story only for a
 * small render: navigation chrome, a link list, a cookie wall. A render that
 * carries this many substantial lines is a document whatever its ratio — a
 * reference page of short code lines and table rows reaches 88 percent short
 * lines — and the fallback it would be sent to is the raw HTML of the same
 * page, which is never the better answer for one.
 */
const SUBSTANTIAL_LINES = 40;

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

/**
 * The adapter pipeline of design D9 over a body the HTTP client already vetted
 * as text. A negotiated Markdown or plain-text body, and any body outside the
 * HTML path, wins as served. An HTML body tries an announced Markdown
 * alternate, then the publisher's Markdown suffix, then the local render, and
 * only a render that fails the quality gate walks `llms.txt` before the raw
 * fallback. Nothing here fetches on its own: every derived locator is admitted
 * through `deps.admit` before its request and issued through `deps.fetch`, so
 * it is bounded by the same client and the same call budget as the first
 * request.
 */
export async function renderWebContent(
  response: WebResponse,
  options: { readonly raw: boolean },
  deps: WebPipelineDeps,
): Promise<WebRender | WebFetchFailure> {
  // `:raw` skips every probe and conversion.
  if (options.raw) return { method: 'raw', content: response.body };
  if (bodyPath(response) !== 'html') {
    return renderWebDocument(response, options);
  }

  return runHtmlPipeline(response, deps);
}

/**
 * The HTML path: the publisher's own Markdown first — the announced alternate,
 * then the suffix candidate — then the local render, and, only when that
 * render fails the quality gate, the `llms.txt` walk before the raw fallback.
 */
async function runHtmlPipeline(
  response: WebResponse,
  deps: WebPipelineDeps,
): Promise<WebRender | WebFetchFailure> {
  // Parsed at most once, and only once a step needs the document: a `Link`
  // header announcement is found without it, and the render parses the body
  // when no probe won.
  let parsed: ParsedWebDocument | undefined;
  const page = (): ParsedWebDocument | undefined => {
    if (EMPTY_BODY.test(response.body)) return undefined;
    parsed ??= parseWebDocument(response.body, response.finalUrl);
    return parsed;
  };

  const published = await publisherMarkdown(response, page, deps);
  if (published !== undefined) return published;

  const document = page();
  const rendered =
    document === undefined
      ? unconverted(response, '')
      : renderPage(response, document);
  // Only a render that failed the gate justifies the walk.
  if (rendered.method === 'readability') return rendered;

  const walked = await firstDecisiveProbe(
    'llms-txt',
    llmsTxtCandidates(response.finalUrl),
    deps,
  );

  // A candidate that answers for itself cannot cost the call the render the
  // walk runs after; a failure of the call's own bound — its deadline, its
  // redirect budget — is still the call's, from here as from every probe.
  return walked ?? rendered;
}

/** The Markdown a publisher announces: the response's `Link` header first,
 *  then the head's `<link rel="alternate">`, then the suffix candidate. */
async function publisherMarkdown(
  response: WebResponse,
  page: () => ParsedWebDocument | undefined,
  deps: WebPipelineDeps,
): Promise<WebRender | WebFetchFailure | undefined> {
  const announced =
    announcedAlternate(response) ?? headAlternate(page(), response.finalUrl);
  const alternate = await firstDecisiveProbe(
    'alternate',
    announced === undefined ? [] : [announced],
    deps,
  );
  if (alternate !== undefined) return alternate;

  return firstDecisiveProbe(
    'suffix',
    suffixCandidates(response.finalUrl),
    deps,
  );
}

/** The failures that answer for one candidate alone, by the types the client
 *  reports: the site has nothing at that locator, refuses its content type or
 *  size, the transport to it failed, it answered no headers before the bound
 *  the client arms for its own request expired, it answered a redirect the
 *  client cannot follow, or a redirect it did answer named a hop the `read`
 *  group refused. Each is that candidate's own bad answer — the header bound
 *  is re-armed for every request, so a host that accepts TCP and stays silent
 *  spends only its own allowance; a redirect without a followable `Location`
 *  is that response's defect; and a refused hop is the candidate's own, since
 *  the candidate itself is admitted before its request, so the only locator of
 *  its chain the group can refuse is one it redirects to — so the next
 *  candidate decides. The call's own request chain is never among them: the
 *  executor fetches the submitted locator and the hops it follows, so a
 *  refusal there ends the read before a candidate is derived.
 *  Every other failure spends a bound of the call — its 30-second deadline,
 *  its redirect budget, or the caller's abort — and is the call's, from every
 *  probe. */
const CANDIDATE_FAILURES = {
  http_status: true,
  unsupported_content_type: true,
  body_too_large: true,
  network_error: true,
  headers_timeout: true,
  invalid_redirect: true,
  permission_denied: true,
};

/**
 * Probes one kind's candidates in order and returns the first winning render,
 * or the failure that ends the call. A candidate the `read` group refuses, one
 * that answers a failure of its own — its status, its content type, its body's
 * size, the transport to it, its own silent wait for headers, a redirect it
 * served without a followable `Location`, or a hop of its own chain the `read`
 * group refused — and one whose body fails the gate are each disqualified
 * without failing the call, so the next candidate decides, and a later
 * `llms.txt` candidate still leaves the render that already exists.
 *
 * A failure of a bound the call has already paid ends the call from every
 * probe, the walk included: a call past its deadline or redirect budget must
 * not keep probing, and the render the walk runs after is not an outcome it
 * may still report.
 */
async function firstDecisiveProbe(
  kind: ProbeKind,
  urls: ReadonlyArray<string>,
  deps: WebPipelineDeps,
): Promise<WebRender | WebFetchFailure | undefined> {
  for (const url of urls) {
    if (deps.admit(kind, url).decision !== 'allow') continue;
    const fetched = await deps.fetch(url);
    if ('type' in fetched) {
      // Only the failures a candidate answers for itself are disqualified; a
      // deeper failure is the call's, and the walk may not swallow it either.
      if (Object.hasOwn(CANDIDATE_FAILURES, fetched.type)) continue;
      return fetched;
    }
    if (passesProbeGate(kind, fetched.body)) {
      // The probe's own response is where the content came from, so its final
      // URL — not the page's — is what the result must report.
      return {
        method: PROBE_METHODS[kind],
        content: fetched.body,
        finalUrl: fetched.finalUrl,
      };
    }
  }

  return undefined;
}

/**
 * Judges a probe's body. A Markdown candidate is judged as the local render
 * is — the quality gate plus a shape test, because an HTML error page is not a
 * Markdown file — while an `llms.txt` candidate is judged on length and shape
 * alone, because an index file is short link lines by construction.
 */
function passesProbeGate(kind: ProbeKind, body: string): boolean {
  if (HTML_MARKUP_START.test(body)) return false;
  if (kind === 'llms-txt') {
    return body.replaceAll(/\s+/g, '').length > MIN_CONTENT_CHARS;
  }

  return passesQualityGate(body);
}

/** A Markdown alternate announced by the response's `Link` header, the
 *  relation llmstxt.org v2 defines. */
function announcedAlternate(response: WebResponse): string | undefined {
  const header = response.link;
  if (header === undefined) return undefined;
  for (const value of header.split(LINK_VALUE_SEPARATOR)) {
    const target = LINK_TARGET.exec(value);
    // An empty target resolves to the page itself, which is not an alternate.
    if (target === null || target[1].trim() === '') continue;
    const parameters = linkParameters(target[2]);
    if (
      !isMarkdownAlternate(
        parameters.get('rel') ?? '',
        parameters.get('type') ?? '',
      )
    ) {
      continue;
    }
    const resolved = resolveCandidate(target[1], response.finalUrl);
    if (resolved !== undefined) return resolved;
  }

  return undefined;
}

/** A head `<link rel="alternate" type="text/markdown">`, resolved against the
 *  page's own URL. Only the head announces: a `link` in the body is page
 *  content, and a page that renders third-party HTML — a wiki page, a comment,
 *  an issue body — would otherwise let a contributor point the read at a
 *  locator of their choosing. A fragment announces nothing either, because
 *  `parseWebDocument` puts its markup in a `body` outside the wrapper's head. */
function headAlternate(
  page: ParsedWebDocument | undefined,
  finalUrl: string,
): string | undefined {
  const links = page?.document.head.querySelectorAll('link[rel]') ?? [];
  for (const link of links) {
    const rel = link.getAttribute('rel') ?? '';
    const type = link.getAttribute('type') ?? '';
    if (!isMarkdownAlternate(rel, type)) continue;
    const href = link.getAttribute('href');
    if (href === null) continue;
    const resolved = resolveCandidate(href, finalUrl);
    if (resolved !== undefined) return resolved;
  }

  return undefined;
}

/** The publisher's Markdown suffix map: `/a/b.html` tries `/a/b.html.md`,
 *  `/a/b` tries `/a/b.md`, and `/a/b/` tries `/a/b/index.md`. A query and
 *  fragment are not part of a sibling file's locator, so the candidate drops
 *  them. */
function suffixCandidates(finalUrl: string): ReadonlyArray<string> {
  const url = webUrl(finalUrl);
  if (url === undefined) return [];
  url.pathname = url.pathname.endsWith('/')
    ? `${url.pathname}index.md`
    : `${url.pathname}.md`;
  url.search = '';
  url.hash = '';

  return [url.href];
}

/** The `llms.txt` walk: the page's own scope (its path read as a directory)
 *  and the two below it, then the site root. */
function llmsTxtCandidates(finalUrl: string): ReadonlyArray<string> {
  const url = webUrl(finalUrl);
  if (url === undefined) return [];
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const candidates: Array<string> = [];
  for (let depth = segments.length; depth > 0; depth -= 1) {
    if (candidates.length === MAX_LLMS_TXT_SCOPES) break;
    candidates.push(
      `${url.origin}/${segments.slice(0, depth).join('/')}/llms.txt`,
    );
  }
  candidates.push(`${url.origin}/llms.txt`);

  return candidates;
}

/** A web URL the tool may fetch; anything else is not a candidate. */
function webUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url
    : undefined;
}

/** Resolves an announced target against the page's URL. A non-web scheme is
 *  not a candidate, so a `file://` or `javascript:` announcement is ignored
 *  rather than requested, and neither is one carrying credentials: the
 *  locator parser refuses a submitted `user:secret@` locator, and an
 *  announcement must not reach a request the model would have been refused
 *  for — or the client's failure message, which repeats the URL verbatim. A
 *  fragment never leaves the process, so it is dropped before admission and
 *  before the request, exactly as the hop path drops a redirect's: the text
 *  policy matches is then the URL the request uses, so an exact reject cannot
 *  miss the fragment-free text. */
function resolveCandidate(value: string, base: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim(), base);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  // An empty fragment setter drops the `#` delimiter with it, so a bare `#`
  // leaves no trace either.
  url.hash = '';

  return url.href;
}

/** Whether a `Link` relation names an alternate Markdown representation. */
function isMarkdownAlternate(rel: string, type: string): boolean {
  if (!rel.toLowerCase().split(/\s+/u).includes('alternate')) return false;

  const mediaType = type.split(';')[0]?.trim().toLowerCase() ?? '';

  return mediaType === 'text/markdown';
}

/** The parameters of one `Link` header value, by lowercased name. */
function linkParameters(value: string): Map<string, string> {
  const parameters = new Map<string, string>();
  for (const match of value.matchAll(LINK_PARAMETER)) {
    const name = match[1];
    if (name === undefined) continue;
    parameters.set(name.toLowerCase(), match[2] ?? match[3] ?? '');
  }

  return parameters;
}

/** A body whose first non-whitespace character opens a tag is treated as markup. */
const HTML_MARKUP_START = /^\s*<[a-z!/?]/i;

const EMPTY_BODY = /^\s*$/;

/** One `Link` header value: a target in angle brackets and its parameters
 *  (RFC 8288). The separator only splits where a comma starts a new target, so
 *  a quoted parameter may contain one. */
const LINK_VALUE_SEPARATOR = /,(?=\s*<)/u;
const LINK_TARGET = /^\s*<([^>]*)>([\s\S]*)$/u;
const LINK_PARAMETER = /;\s*([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|([^;,\s]*))/gu;

/** How the served body is treated: taken as served, returned as text, or sent
 *  through the HTML pipeline. */
type BodyPath = 'negotiated' | 'text' | 'html';

/**
 * Renders the body of a response the HTTP client already vetted as text.
 * `raw` skips every conversion; otherwise a publisher Markdown or plain-text
 * body wins as served, an HTML body is rendered locally, and any other text
 * body (JSON, XML, other `text/*`) is returned unchanged. This is the
 * probe-free renderer; `renderWebContent` is the pipeline that prefers
 * publisher Markdown first.
 */
export function renderWebDocument(
  response: WebResponse,
  options: { readonly raw: boolean },
): WebRender {
  if (options.raw) return { method: 'raw', content: response.body };

  const path = bodyPath(response);
  if (path === 'negotiated') {
    return { method: 'negotiated', content: response.body };
  }
  if (path === 'text') return { method: 'text', content: response.body };

  // linkedom cannot build a document from an empty body, and there is nothing
  // to convert, so the raw fallback is taken without parsing.
  if (EMPTY_BODY.test(response.body)) return unconverted(response, '');

  return renderPage(
    response,
    parseWebDocument(response.body, response.finalUrl),
  );
}

/**
 * The client lowercases the media type but keeps the header's parameters.
 * `application/xhtml+xml` is HTML, and so is a `text/plain` body shaped like
 * markup; every other accepted type — JSON, XML (including a `+xml` suffix),
 * and other `text/*` — is returned unchanged as text.
 */
function bodyPath(response: WebResponse): BodyPath {
  const mediaType = response.contentType.split(';', 1)[0].trim().toLowerCase();
  if (mediaType === 'text/markdown') return 'negotiated';
  if (mediaType === 'text/plain') {
    return HTML_MARKUP_START.test(response.body) ? 'html' : 'negotiated';
  }
  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') {
    return 'html';
  }

  return 'text';
}

/**
 * Judges converted text: a stub, or a low-quality body, is not content the
 * tool may present as the page.
 */
export function passesQualityGate(text: string): boolean {
  if (text.replaceAll(/\s+/g, '').length <= MIN_CONTENT_CHARS) return false;

  return !isLowQuality(text);
}

/** Readability over an already parsed document, which it is free to mutate
 *  afterwards; the whole body is converted when it finds no article. */
function renderPage(response: WebResponse, page: ParsedWebDocument): WebRender {
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
  if (lines.length - shortLines >= SUBSTANTIAL_LINES) return false;

  return shortLines / lines.length > SHORT_LINE_RATIO;
}

function findChallengePhrase(text: string): string | undefined {
  const lowered = text.toLowerCase();

  return CHALLENGE_PHRASES.find((phrase) => lowered.includes(phrase));
}
