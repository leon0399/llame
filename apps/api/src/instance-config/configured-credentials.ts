import {
  isCredentialName,
  type InterpolationResult,
  type InterpolationSpan,
} from '@workspace/config-interpolation';
import { normalizeProtectedValues } from '@workspace/runtime-safety';

import type { LlameConfig } from './llame-config';

/**
 * The 8-character floor applies ONLY to inferred credentials — a database
 * password, `PGPASSWORD`, and a URL userinfo username — because those can be
 * common words such as `app`. A configured credential field is a member at any
 * nonblank length (proposal A4).
 */
const INFERRED_CREDENTIAL_MIN_LENGTH = 8;

type UrlCredentialSpans = Readonly<{
  username?: InterpolationSpan;
  password?: InterpolationSpan;
  query?: InterpolationSpan;
}>;

/**
 * The set is deliberately off `LlameConfig`: no serializer, spread, or deep
 * comparison can carry it, and a configuration the loader did not build (a
 * test fixture, an integration stub) reads as empty.
 */
const CONFIGURED_CREDENTIALS = new WeakMap<
  LlameConfig,
  ReadonlyArray<string>
>();

/** The protected set `loadInstanceConfig` derived for `config`, or empty. */
export function configuredCredentials(
  config: LlameConfig,
): ReadonlyArray<string> {
  return CONFIGURED_CREDENTIALS.get(config) ?? [];
}

/**
 * Loader-internal writer for the WeakMap above: records the set the loader
 * collected for the configuration it is about to return. Callers read through
 * {@link configuredCredentials}.
 */
export function recordConfiguredCredentials(
  config: LlameConfig,
  members: ReadonlyArray<string>,
): void {
  CONFIGURED_CREDENTIALS.set(config, members);
}

/**
 * Collects configured credentials while the loader resolves each field that
 * names one (design D1). Blank values never count; the trimmed spelling is
 * kept alongside a padded one because a printed value may carry either.
 */
export class ConfiguredCredentialCollector {
  private readonly members: Array<string> = [];

  /** Seeds the members read from the environment the loader was given. */
  constructor(env: NodeJS.ProcessEnv) {
    this.addPostgresUrl(env.POSTGRES_URL);
    this.add(env.PGPASSWORD, INFERRED_CREDENTIAL_MIN_LENGTH);
  }

  /** `onResolved` hook for a credential field (a provider, engine, or adapter secret). */
  readonly onSecret = (result: InterpolationResult): void =>
    this.addSecret(result);

  /** `onResolved` hook for a configured URL (a provider `baseUrl`). */
  readonly onUrl = (result: InterpolationResult): void =>
    this.addUrlMembers(result);

  /**
   * A credential field: the whole resolved value, and the credential leaves of
   * any selected JSON document. A substitution inside the field is deliberately
   * NOT a member on its own — design D1 takes whole values for credential
   * fields, so `secret-prefix-{env:VERSION}-suffix` does not make `1` a
   * member.
   */
  addSecret(result: InterpolationResult): void {
    this.add(result.value);
    for (const substitution of result.substituted) {
      for (const leaf of substitution.documentLeaves) this.add(leaf);
    }
  }

  /**
   * One header value, or one `{session:id}`-separated part of a provider
   * header. A non-literal value contributes only its substitutions; a literal
   * value contributes itself when its header name is credential-shaped. The
   * caller decides literalness once for the whole value and passes `literal`.
   */
  addHeaderValue(
    name: string,
    result: InterpolationResult,
    literal: boolean,
  ): void {
    if (!literal) {
      this.addSubstitutions(result);
      return;
    }
    if (isCredentialName(name)) this.add(result.value);
  }

  /**
   * Every substitution of a credential-bearing value, excluding `:-` fallback
   * text (a default written in the file is not a secret), plus the credential
   * leaves of a selected JSON document when the token was `{path:…|json:…}`.
   * The spelling is the one written: header and stdio values are not URLs.
   */
  addSubstitutions(result: InterpolationResult): void {
    for (const substitution of result.substituted) {
      if (substitution.fallback) continue;
      this.add(substitution.value);
      for (const leaf of substitution.documentLeaves) this.add(leaf);
    }
  }

  /**
   * A URL's credentials: substitutions resolved inside its userinfo password
   * or query, its userinfo password at any nonblank length, its userinfo
   * username from 8 characters, and each query value under a credential-shaped
   * name — each as written and percent-decoded, and never the whole URL. Spans
   * are computed on the raw resolved string, not on a re-serialized `URL`.
   */
  addUrlMembers(result: InterpolationResult): void {
    const spans = urlCredentialSpans(result.value);
    this.addUrlSubstitutions(result, spans);
    this.addUserinfoMembers(result.value, spans);
    this.addQueryCredentialValues(result.value, spans);
  }

  /**
   * A substitution resolved inside the userinfo password or the query, in the
   * spelling written and its percent-decoded form: the URL may carry either
   * (`secret%2Fcanary` travels as-is, `secret/canary` once a consumer decodes
   * it). `:-` fallback text is not a secret.
   */
  private addUrlSubstitutions(
    result: InterpolationResult,
    spans: UrlCredentialSpans,
  ): void {
    for (const substitution of result.substituted) {
      if (substitution.fallback) continue;
      if (
        !within(spans.password, substitution) &&
        !within(spans.query, substitution)
      ) {
        continue;
      }
      this.addEncodedAndDecoded(substitution.value);
      for (const leaf of substitution.documentLeaves) {
        this.addEncodedAndDecoded(leaf);
      }
    }
  }

  /** Normalized (deduped, longest first) and deeply frozen. */
  snapshot(): ReadonlyArray<string> {
    return Object.freeze(normalizeProtectedValues(this.members));
  }

  private add(value: string | undefined, minimumLength?: number): void {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    if (minimumLength !== undefined && trimmed.length < minimumLength) return;
    this.members.push(value);
    if (trimmed !== value) this.members.push(trimmed);
  }

  private addEncodedAndDecoded(value: string, minimumLength?: number): void {
    if (value.length === 0) return;
    this.add(value, minimumLength);
    const decoded = percentDecoded(value);
    if (decoded !== undefined && decoded !== value) {
      this.add(decoded, minimumLength);
    }
  }

  /**
   * `POSTGRES_URL` is read outside the configuration file, so the loader never
   * interpolates it: the whole string, plus its password in both
   * percent-encoded and decoded spellings, is the member. The password comes
   * from the raw userinfo spans, so multi-host and socket connection strings
   * that `new URL` cannot parse still contribute it.
   */
  private addPostgresUrl(value: string | undefined): void {
    if (value === undefined || value.trim().length === 0) return;
    this.add(value);
    const spans = urlCredentialSpans(value);
    if (spans.password === undefined) return;
    this.addEncodedAndDecoded(
      value.slice(spans.password.start, spans.password.end),
      INFERRED_CREDENTIAL_MIN_LENGTH,
    );
  }

  private addUserinfoMembers(rawUrl: string, spans: UrlCredentialSpans): void {
    if (spans.username !== undefined) {
      this.addEncodedAndDecoded(
        rawUrl.slice(spans.username.start, spans.username.end),
        INFERRED_CREDENTIAL_MIN_LENGTH,
      );
    }
    if (spans.password !== undefined) {
      this.addEncodedAndDecoded(
        rawUrl.slice(spans.password.start, spans.password.end),
      );
    }
  }

  private addQueryCredentialValues(
    rawUrl: string,
    spans: UrlCredentialSpans,
  ): void {
    if (spans.query === undefined) return;
    const query = rawUrl.slice(spans.query.start, spans.query.end);
    for (const pair of query.split('&')) {
      const equals = pair.indexOf('=');
      const rawName = equals === -1 ? pair : pair.slice(0, equals);
      const rawValue = equals === -1 ? '' : pair.slice(equals + 1);
      const name = percentDecoded(rawName) ?? rawName;
      if (isCredentialName(name)) this.addEncodedAndDecoded(rawValue);
    }
  }
}

/** Whether a substitution's resolved span lies entirely inside `span`. */
function within(
  span: InterpolationSpan | undefined,
  substitution: InterpolationSpan,
): boolean {
  return (
    span !== undefined &&
    substitution.start >= span.start &&
    substitution.end <= span.end
  );
}

/**
 * The userinfo and query spans of an absolute URL, computed by scanning the
 * raw string so a resolved (possibly substituted) URL — and a `POSTGRES_URL`
 * `new URL` cannot parse — is read exactly as written. WHATWG, the loader's
 * validator, treats `https://host/`, `https:/host/`, and `https:host/` alike
 * for HTTP(S) (and `\` as `/`), so the authority starts after the scheme colon
 * plus any slash run rather than after a literal `://`.
 */
function urlCredentialSpans(url: string): UrlCredentialSpans {
  const start = leadingWhitespaceLength(url);
  const colon = schemeColon(url, start);
  if (colon === undefined) return {};
  const query = querySpan(url, colon + 1);
  const scheme = url.slice(start, colon).toLowerCase();
  const hasAuthority =
    scheme === 'http' || scheme === 'https' || url.startsWith('//', colon + 1);
  if (!hasAuthority) return query === undefined ? {} : { query };

  const authorityStart = skipAuthoritySlashes(url, colon + 1);
  const authorityEnd = indexOfFirstOf(
    url,
    ['/', '\\', '?', '#'],
    authorityStart,
  );
  return {
    ...userinfoSpans(url, authorityStart, authorityEnd),
    ...(query !== undefined && { query }),
  };
}

/**
 * The number of leading whitespace characters. The loader trims a resolved URL
 * before it stores or validates it, but the scanner reads the raw resolved
 * string so substitution offsets still line up: a padded literal or `{env:…}`
 * value must not hide its scheme.
 */
function leadingWhitespaceLength(url: string): number {
  let index = 0;
  while (index < url.length && isWhitespace(url.charCodeAt(index))) {
    index += 1;
  }
  return index;
}

/** The ECMAScript `WhiteSpace`/`LineTerminator` set, which `trim()` applies. */
function isWhitespace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x16_80 ||
    (code >= 0x20_00 && code <= 0x20_0a) ||
    code === 0x20_28 ||
    code === 0x20_29 ||
    code === 0x20_2f ||
    code === 0x20_5f ||
    code === 0x30_00 ||
    code === 0xfe_ff
  );
}

/**
 * The index of the scheme's `:`, when the substring from `from` starts with a
 * valid scheme. `from` is the first non-whitespace character; spans stay in
 * raw-string coordinates so they still match substitution spans.
 */
function schemeColon(url: string, from: number): number | undefined {
  const colon = url.indexOf(':', from);
  if (colon <= from) return undefined;
  return /^[A-Za-z][A-Za-z0-9+.-]*$/u.test(url.slice(from, colon))
    ? colon
    : undefined;
}

/** The authority's first non-slash character; WHATWG accepts `//`, `/`, and none. */
function skipAuthoritySlashes(url: string, from: number): number {
  let index = from;
  while (url[index] === '/' || url[index] === '\\') index += 1;
  return index;
}

function userinfoSpans(
  url: string,
  authorityStart: number,
  authorityEnd: number,
): UrlCredentialSpans {
  const userinfoEnd = url.lastIndexOf('@', authorityEnd - 1);
  if (userinfoEnd < authorityStart) return {};
  const colon = url.indexOf(':', authorityStart);
  if (colon === -1 || colon > userinfoEnd) {
    return { username: { start: authorityStart, end: userinfoEnd } };
  }
  return {
    username: { start: authorityStart, end: colon },
    password: { start: colon + 1, end: userinfoEnd },
  };
}

function querySpan(url: string, from: number): InterpolationSpan | undefined {
  const queryStart = url.indexOf('?', from);
  const fragmentStart = url.indexOf('#', from);
  if (queryStart === -1) return undefined;
  if (fragmentStart !== -1 && fragmentStart < queryStart) return undefined;
  return {
    start: queryStart + 1,
    end: fragmentStart === -1 ? url.length : fragmentStart,
  };
}

/** The nearest occurrence of any character at or after `from`, or `value.length`. */
function indexOfFirstOf(
  value: string,
  characters: ReadonlyArray<string>,
  from: number,
): number {
  let nearest = value.length;
  for (const character of characters) {
    const at = value.indexOf(character, from);
    if (at !== -1 && at < nearest) nearest = at;
  }
  return nearest;
}

function percentDecoded(value: string): string | undefined {
  if (!value.includes('%')) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
