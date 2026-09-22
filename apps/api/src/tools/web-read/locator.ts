import { isSelectorSuffix } from '@workspace/native-file-tools';

/**
 * A web locator the tool will request: the canonical URL text with the
 * trailing selector split off, so `url` is exactly what leaves the process
 * and exactly what policy matches.
 */
export type WebLocator = { readonly url: string; readonly selector?: string };

export type WebLocatorError = {
  readonly type: 'invalid_path' | 'invalid_selector';
  readonly message: string;
};

/**
 * The shipped trailing-selector grammar, reused unchanged: the `:raw` forms
 * first, else the last colon after the last slash. A URL's own scheme colon
 * can never win, because it always precedes the authority's slashes; whether
 * a match may split at all is `opensSelector`'s call.
 */
const RAW_SELECTOR = /:raw(?::([^:/]*))?$/u;

const INVALID_URL_MESSAGE =
  'Write this locator as an absolute http:// or https:// URL.';
/** Names no part of the locator: a credential must never reach the model. */
const CREDENTIALS_MESSAGE =
  'A web locator must not carry credentials; remove the userinfo before the host.';

/** A locator split from its trailing selector, before either is validated. */
type SplitLocator = { url: string; selector?: string };

/**
 * Whether the colon at `index` may begin a selector, which only ever trails
 * the last path segment. A locator that carries a query or a fragment cannot
 * hold one: every colon the query or the fragment opened — `?time=10:30:00`,
 * `#x:raw`, or `?b/c:10-20`, whose last slash sits inside the query — is URL
 * text, and splitting at one would request a URL the model never wrote and
 * silently drop the rest of its own locator. Admission refuses a fragment
 * before the split, so the `#` half of the test is this helper's own
 * invariant rather than a state its caller can reach.
 */
function opensSelector(text: string, index: number): boolean {
  if (index <= text.lastIndexOf('/')) return false;
  return !/[?#]/u.test(text);
}

function splitSelector(text: string): SplitLocator {
  const raw = RAW_SELECTOR.exec(text);
  if (raw !== null && opensSelector(text, raw.index)) {
    const suffix = raw[1] === undefined ? 'raw' : `raw:${raw[1]}`;
    return { url: text.slice(0, raw.index), selector: suffix };
  }
  const colon = text.lastIndexOf(':');
  if (!opensSelector(text, colon)) return { url: text };
  return { url: text.slice(0, colon), selector: text.slice(colon + 1) };
}

/**
 * Admit one URL text: parsable, web scheme, no credentials, no fragment. Only
 * an admitted text may reach a message that names it or a request that uses
 * it.
 */
function parseWebUrl(
  text: string,
): { readonly href: string } | WebLocatorError {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { type: 'invalid_path', message: INVALID_URL_MESSAGE };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { type: 'invalid_path', message: INVALID_URL_MESSAGE };
  }
  if (url.username !== '' || url.password !== '') {
    return { type: 'invalid_path', message: CREDENTIALS_MESSAGE };
  }
  // A fragment never reaches the server, so admitting it would let the locator
  // text policy matched differ from the requested URL; a bare `#` is a
  // fragment too, and leaves `hash` empty, so the delimiter itself is read.
  const delimiter = url.href.indexOf('#');
  if (delimiter !== -1) {
    return {
      type: 'invalid_path',
      message: `Write this locator as ${url.href.slice(0, delimiter)}`,
    };
  }
  return { href: url.href };
}

/**
 * The spelling the model resubmits for a suffix that meant a literal colon.
 * Every colon of the last path segment is encoded, not only the one the split
 * took: a hint that leaves an earlier one behind splits again on the next
 * attempt, so the model pays another cycle per colon. The scheme, host, and
 * port colons precede the last slash and stay as the model wrote them.
 */
function encodedSuggestion(href: string, selector: string): string {
  const lastSlash = href.lastIndexOf('/');
  const segment = `${href.slice(lastSlash + 1)}:${selector}`.replaceAll(
    ':',
    '%3A',
  );
  return `Write this locator as ${href.slice(0, lastSlash + 1)}${segment}`;
}

/**
 * A suffix that plainly meant line numbers (`:1`, `:12+`), which the shipped
 * grammar has no form for. Telling that model to percent-encode the colon
 * answers a question it did not ask, so the ranges it can write are named
 * first and the literal-colon spelling second.
 */
const LINE_SELECTOR_ATTEMPT = /^\d+[-+]?$/u;

function invalidSelectorMessage(href: string, selector: string): string {
  const encoded = encodedSuggestion(href, selector);
  if (!LINE_SELECTOR_ATTEMPT.test(selector)) return encoded;
  const start = selector.replace(/[-+]$/u, '');
  return `A line selector is :N-M or :N+K, so one line is :${start}-${start}. For a literal colon, ${lowerFirst(encoded)}`;
}

function lowerFirst(text: string): string {
  return `${text[0].toLowerCase()}${text.slice(1)}`;
}

/**
 * The two admitted schemes, as the model must spell them. The submitted text
 * is the text policy matched, so a scheme written in any other case is a
 * locator that is not its own serialization rather than one to lower-case.
 */
const WEB_SCHEME_PREFIX = /^(?:https?):\/\//u;

/**
 * The hint for a locator the URL parser rejected outright. A selector written
 * straight after the authority (`https://example.test:1-5`) reads as a port,
 * so the whole text fails to parse and the generic message would leave the
 * model guessing at a locator that is nearly right. When the text before the
 * last colon is a web URL and the suffix is a real selector, the spelling
 * that works is that URL's serialization — which supplies the missing path —
 * carrying the same selector.
 */
function selectorOnAuthority(submitted: string): WebLocatorError {
  const generic: WebLocatorError = {
    type: 'invalid_path',
    message: INVALID_URL_MESSAGE,
  };
  const { url, selector } = splitSelector(submitted);
  if (selector === undefined || !isSelectorSuffix(selector)) return generic;
  const target = parseWebUrl(url);
  if ('type' in target) return generic;
  return {
    type: 'invalid_path',
    message: `Write this locator as ${target.href}:${selector}`,
  };
}

/**
 * Parse one submitted locator. `invalid_path` covers a locator that is not
 * its own WHATWG serialization — including a scheme the model spelled in
 * uppercase, which the URL parser would silently lower-case — a non-web
 * scheme, userinfo, and a fragment, which the request would drop; a suffix
 * outside the selector grammar is the caller's `invalid_selector`. Every
 * message names the canonical spelling the model should send instead, so a
 * reject clause written against that spelling cannot be evaded by an
 * uppercase, encoded, or default-port variant, and no admitted locator
 * carries text the request would drop.
 */
export function parseWebLocator(
  submitted: string,
): WebLocator | WebLocatorError {
  // Admitted whole before the split: a userinfo the split would cut through
  // (`https://user:secret@host`) is refused here, so no later message can
  // name a credential.
  const admitted = parseWebUrl(submitted);
  if ('type' in admitted) {
    return admitted.message === INVALID_URL_MESSAGE
      ? selectorOnAuthority(submitted)
      : admitted;
  }
  // Read from the submitted text, never from a scheme the dispatcher
  // lower-cased: policy matched that text, so an uppercase scheme is refused
  // here, naming the spelling the model should resubmit.
  if (!WEB_SCHEME_PREFIX.test(submitted)) {
    return {
      type: 'invalid_path',
      message: `Write this locator as ${admitted.href}`,
    };
  }
  const { url, selector } = splitSelector(submitted);
  // And admitted again after it, because only the URL that will actually be
  // requested may reach policy or the network.
  const target = parseWebUrl(url);
  if ('type' in target) return target;
  if (target.href !== url) {
    // Name the whole submitted locator's serialization, not the split
    // remainder's: the split consumes a port (`https://example.test:8080`
    // leaves `https://example.test`), and a hint that dropped it would send
    // the next request to a different endpoint. The whole text keeps the port
    // and any real selector, and re-splits the same way on resubmission.
    return {
      type: 'invalid_path',
      message: `Write this locator as ${admitted.href}`,
    };
  }
  if (selector !== undefined && !isSelectorSuffix(selector)) {
    return {
      type: 'invalid_selector',
      message: invalidSelectorMessage(target.href, selector),
    };
  }
  return selector === undefined ? { url } : { url, selector };
}
