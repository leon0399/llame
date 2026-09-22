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
 * the last segment of a path. A locator with no path at all cannot hold one:
 * the only colon after its scheme opens the port, so `https://example.test:88`
 * is port 88 and `https://example.test/:88` is line 88 of the site root. A
 * locator that carries a query or a fragment cannot hold one either: every
 * colon the query or the fragment opened — `?time=10:30:00`, `#x:raw`, or
 * `?b/c:10-20`, whose last slash sits inside the query — is URL text, and
 * splitting at one would request a URL the model never wrote and silently
 * drop the rest of its own locator.
 */
function opensSelector(text: string, index: number): boolean {
  const authority = text.indexOf('//') + 2;
  const lastSlash = text.lastIndexOf('/');
  if (lastSlash < authority) return false;
  if (index <= lastSlash) return false;
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
 * Admit one URL text: parsable, web scheme, no credentials. The caller has
 * already cut any fragment off, so only an admitted, fragment-free text
 * reaches a message that names it or a request that uses it.
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
  // `https://example.test./` is the same host as `https://example.test/` —
  // the trailing dot is the DNS root — but the URL parser keeps it, so a
  // reject clause written for the host would miss the dotted spelling. The
  // canonical form has no root dot, so neither does the text policy matches
  // or the request.
  if (url.hostname.endsWith('.')) {
    url.hostname = url.hostname.slice(0, -1);
  }
  return { href: url.href };
}

/**
 * The locator without the fragment the request would drop anyway. A page's
 * anchor is ordinary text in the links a model reads, so refusing it cost a
 * call and taught nothing; cutting it here keeps one text for the policy
 * decision, the message, and the request. A bare `#` is a fragment too.
 */
export function stripFragment(text: string): string {
  const delimiter = text.indexOf('#');
  return delimiter === -1 ? text : text.slice(0, delimiter);
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
 * A suffix that meant a line the grammar cannot serve (`:0`, `:12+`). The
 * ranges the model can write are named first and the literal-colon spelling
 * second, because that model asked for a line, not a path.
 */
const LINE_SELECTOR_ATTEMPT = /^\d+[-+]?$/u;

function invalidSelectorMessage(href: string, selector: string): string {
  const encoded = encodedSuggestion(href, selector);
  if (!LINE_SELECTOR_ATTEMPT.test(selector)) return encoded;
  const start = selector.replace(/[-+]$/u, '');
  return `A line selector is :N, :N-M, or :N+K, and a line number starts at 1, so line ${start} is :${start}. For a literal colon, ${lowerFirst(encoded)}`;
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
 * The hint for a locator the URL parser rejected outright. Two of those are
 * worth naming rather than answering with "write an absolute URL", which
 * tells a model that wrote a nearly correct locator nothing: a selector
 * written straight after the authority (`https://example.test:1-5`) sits
 * where the port belongs, and a port that is not a number
 * (`https://example.test:abc/`) is the only broken part of an otherwise
 * absolute URL.
 */
function unparsableLocator(text: string): WebLocatorError {
  const generic: WebLocatorError = {
    type: 'invalid_path',
    message: INVALID_URL_MESSAGE,
  };
  const colon = text.lastIndexOf(':');
  if (colon <= text.indexOf('//') + 1) return generic;
  const suffix = text.slice(colon + 1);
  const target = parseWebUrl(text.slice(0, colon));
  if ('type' in target) return generic;
  if (isSelectorSuffix(suffix)) {
    return {
      type: 'invalid_path',
      message: `Write this locator as ${target.href}:${suffix}`,
    };
  }
  // What follows the colon is where the port belongs, so say so and name the
  // same locator without one rather than inventing a number.
  const slash = suffix.indexOf('/');
  const port = slash === -1 ? suffix : suffix.slice(0, slash);
  if (!/^\d*$/u.test(port)) {
    return {
      type: 'invalid_path',
      message: `A port must be a number: write this locator with one, or as ${target.href}`,
    };
  }
  return generic;
}

/**
 * Parse one submitted locator. The fragment the request would drop is cut
 * first, so one fragment-free text is what policy matched, what a message
 * names, and what is requested. `invalid_path` then covers a locator that is
 * not its own WHATWG serialization — including a scheme the model spelled in
 * uppercase, which the URL parser would silently lower-case — a non-web
 * scheme, and userinfo; a suffix outside the selector grammar is the caller's
 * `invalid_selector`. A locator with no path is the one relaxation: its
 * serialization differs only by the empty path's slash, which changes no
 * endpoint, so `https://example.test:88` is admitted and requested as
 * `https://example.test:88/` — its `88` is the port, while the `88` of
 * `https://example.test/:88` is line 88.
 */
export function parseWebLocator(
  submitted: string,
): WebLocator | WebLocatorError {
  const text = stripFragment(submitted);
  // Admitted whole before the split: a userinfo the split would cut through
  // (`https://user:secret@host`) is refused here, so no later message can
  // name a credential.
  const admitted = parseWebUrl(text);
  if ('type' in admitted) {
    return admitted.message === INVALID_URL_MESSAGE
      ? unparsableLocator(text)
      : admitted;
  }
  // Read from the submitted text, never from a scheme the dispatcher
  // lower-cased: policy matched that text, so an uppercase scheme is refused
  // here, naming the spelling the model should resubmit.
  if (!WEB_SCHEME_PREFIX.test(text)) {
    return {
      type: 'invalid_path',
      message: `Write this locator as ${admitted.href}`,
    };
  }
  const { url, selector } = splitSelector(text);
  // And admitted again after it, because only the URL that will actually be
  // requested may reach policy or the network.
  const target = parseWebUrl(url);
  if ('type' in target) return target;
  if (target.href !== url && target.href !== `${url}/`) {
    // Name the whole submitted locator's serialization, not the split
    // remainder's: a hint built from the remainder would drop text the model
    // wrote and can send the next request somewhere else.
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
  return selector === undefined
    ? { url: target.href }
    : { url: target.href, selector };
}
