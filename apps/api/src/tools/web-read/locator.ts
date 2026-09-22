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
 * The shipped trailing-selector split, reused unchanged: the `:raw` forms
 * first, else the last colon after the last slash. A URL's own scheme colon
 * can never win, because it always precedes the authority's slashes.
 */
const RAW_SELECTOR = /:raw(?::([^:/]*))?$/u;

const INVALID_URL_MESSAGE =
  'Write this locator as an absolute http:// or https:// URL.';
/** Names no part of the locator: a credential must never reach the model. */
const CREDENTIALS_MESSAGE =
  'A web locator must not carry credentials; remove the userinfo before the host.';

/** A locator split from its trailing selector, before either is validated. */
type SplitLocator = { url: string; selector?: string };

function splitSelector(text: string): SplitLocator {
  const raw = RAW_SELECTOR.exec(text);
  if (raw) {
    const suffix = raw[1] === undefined ? 'raw' : `raw:${raw[1]}`;
    return { url: text.slice(0, raw.index), selector: suffix };
  }
  const colon = text.lastIndexOf(':');
  if (colon <= text.lastIndexOf('/')) return { url: text };
  return { url: text.slice(0, colon), selector: text.slice(colon + 1) };
}

/**
 * Admit one URL text: parsable, web scheme, no credentials. Only an admitted
 * text may reach a message that names it or a request that uses it.
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
  return { href: url.href };
}

/** The spelling the model resubmits for a suffix that meant a literal colon. */
function encodedSuggestion(href: string, selector: string): string {
  return `Write this locator as ${href}%3A${selector.replaceAll(':', '%3A')}`;
}

/**
 * The two admitted schemes, as the model must spell them. The submitted text
 * is the text policy matched, so a scheme written in any other case is a
 * locator that is not its own serialization rather than one to lower-case.
 */
const WEB_SCHEME_PREFIX = /^(?:https?):\/\//u;

/**
 * Parse one submitted locator. `invalid_path` covers a locator that is not
 * its own WHATWG serialization — including a scheme the model spelled in
 * uppercase, which the URL parser would silently lower-case — a non-web
 * scheme, and userinfo; a suffix outside the selector grammar is the
 * caller's `invalid_selector`. Every message names the canonical spelling
 * the model should send instead, so a reject clause written against that
 * spelling cannot be evaded by an uppercase, encoded, or default-port
 * variant.
 */
export function parseWebLocator(
  submitted: string,
): WebLocator | WebLocatorError {
  // Admitted whole before the split: a userinfo the split would cut through
  // (`https://user:secret@host`) is refused here, so no later message can
  // name a credential.
  const admitted = parseWebUrl(submitted);
  if ('type' in admitted) return admitted;
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
    return {
      type: 'invalid_path',
      message: `Write this locator as ${target.href}`,
    };
  }
  if (selector !== undefined && !isSelectorSuffix(selector)) {
    return {
      type: 'invalid_selector',
      message: encodedSuggestion(target.href, selector),
    };
  }
  return selector === undefined ? { url } : { url, selector };
}
