import {
  isCredentialName,
  type InterpolationResult,
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

/** Code-unit interval in a resolved string. */
type Span = Readonly<{ start: number; end: number }>;

type UrlCredentialSpans = Readonly<{
  username?: Span;
  password?: Span;
  query?: Span;
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
): LlameConfig {
  CONFIGURED_CREDENTIALS.set(config, members);
  return config;
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
    this.add(env.PGPASSWORD, { minimumLength: INFERRED_CREDENTIAL_MIN_LENGTH });
  }

  /** `onResolved` hook for a credential field (a provider, engine, or adapter secret). */
  readonly onSecret = (result: InterpolationResult): void =>
    this.addSecret(result);

  /** `onResolved` hook for a configured URL (a provider `baseUrl`). */
  readonly onUrl = (result: InterpolationResult): void =>
    this.addUrlMembers(result.value, result);

  add(
    value: string | null | undefined,
    opts: { minimumLength?: number } = {},
  ): void {
    if (value === null || value === undefined) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    if (
      opts.minimumLength !== undefined &&
      trimmed.length < opts.minimumLength
    ) {
      return;
    }
    this.members.push(value);
    if (trimmed !== value) this.members.push(trimmed);
  }

  /**
   * Every substitution of a credential-bearing value, excluding `:-` fallback
   * text (a default written in the file is not a secret), plus the credential
   * leaves of a selected JSON document when the token was `{path:…|json:…}`.
   */
  addSubstitutions(result: InterpolationResult): void {
    for (const substitution of result.substituted) {
      if (substitution.fallback) continue;
      this.add(substitution.value);
      for (const leaf of substitution.documentLeaves) this.add(leaf);
    }
  }

  /** A credential field: the whole resolved value plus its document leaves. */
  addSecret(result: InterpolationResult): void {
    this.add(result.value);
    this.addSubstitutions(result);
  }

  /**
   * One header value (or one `{session:id}`-separated part of a provider
   * header): its substitutions, and the value itself when it is written
   * literally under a credential-shaped header name. Literal text around a
   * substitution, such as `Bearer `, is never a member.
   */
  addHeaderValue(name: string, raw: string, result: InterpolationResult): void {
    this.addSubstitutions(result);
    if (isCredentialName(name) && !INTERPOLATION_TOKEN.test(raw)) {
      this.add(result.value);
    }
  }

  /**
   * A URL's credentials: substitutions resolved inside its userinfo password
   * or query, its userinfo password at any nonblank length, its userinfo
   * username from 8 characters, and each query value under a credential-shaped
   * name — each as written and percent-decoded, and never the whole URL. Spans
   * are computed on the raw resolved string, not on a re-serialized `URL`.
   */
  addUrlMembers(rawUrl: string, result: InterpolationResult): void {
    const spans = urlCredentialSpans(rawUrl);
    for (const substitution of result.substituted) {
      if (substitution.fallback) continue;
      if (
        !within(spans.password, substitution) &&
        !within(spans.query, substitution)
      ) {
        continue;
      }
      this.add(substitution.value);
      for (const leaf of substitution.documentLeaves) this.add(leaf);
    }
    this.addUserinfoMembers(rawUrl, spans);
    this.addQueryCredentialValues(rawUrl, spans);
  }

  /**
   * `POSTGRES_URL` is read outside the configuration file, so the loader never
   * interpolates it: the whole string, plus its parsed password in both
   * percent-encoded and decoded spellings, is the member.
   */
  addPostgresUrl(value: string | undefined): void {
    if (value === undefined || value.trim().length === 0) return;
    this.add(value);
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return;
    }
    if (parsed.password.length === 0) return;
    this.add(parsed.password, {
      minimumLength: INFERRED_CREDENTIAL_MIN_LENGTH,
    });
    const decoded = percentDecoded(parsed.password);
    if (decoded !== undefined && decoded !== parsed.password) {
      this.add(decoded, { minimumLength: INFERRED_CREDENTIAL_MIN_LENGTH });
    }
  }

  /** Normalized (deduped, longest first) and deeply frozen. */
  snapshot(): ReadonlyArray<string> {
    return Object.freeze(normalizeProtectedValues(this.members));
  }

  private addUserinfoMembers(rawUrl: string, spans: UrlCredentialSpans): void {
    if (spans.username !== undefined) {
      const username = rawUrl.slice(spans.username.start, spans.username.end);
      this.add(username, { minimumLength: INFERRED_CREDENTIAL_MIN_LENGTH });
      const decoded = percentDecoded(username);
      if (decoded !== undefined && decoded !== username) {
        this.add(decoded, { minimumLength: INFERRED_CREDENTIAL_MIN_LENGTH });
      }
    }
    if (spans.password !== undefined) {
      const password = rawUrl.slice(spans.password.start, spans.password.end);
      this.add(password);
      const decoded = percentDecoded(password);
      if (decoded !== undefined && decoded !== password) this.add(decoded);
    }
  }

  private addQueryCredentialValues(
    rawUrl: string,
    spans: UrlCredentialSpans,
  ): void {
    if (spans.query === undefined) return;
    const query = rawUrl.slice(spans.query.start, spans.query.end);
    for (const pair of query.split('&')) {
      if (pair.length === 0) continue;
      const equals = pair.indexOf('=');
      const rawName = equals === -1 ? pair : pair.slice(0, equals);
      const rawValue = equals === -1 ? '' : pair.slice(equals + 1);
      const name = percentDecoded(rawName) ?? rawName;
      if (!isCredentialName(name)) continue;
      this.add(rawValue);
      const decoded = percentDecoded(rawValue);
      if (decoded !== undefined) this.add(decoded);
    }
  }
}

/** Whether a substitution's resolved span lies entirely inside `span`. */
function within(span: Span | undefined, substitution: Span): boolean {
  return (
    span !== undefined &&
    substitution.start >= span.start &&
    substitution.end <= span.end
  );
}

/**
 * The userinfo and query spans of an absolute URL, computed by scanning the
 * raw string so a resolved (possibly substituted) URL is read exactly as
 * written.
 */
function urlCredentialSpans(url: string): UrlCredentialSpans {
  const schemeAt = url.indexOf('://');
  if (schemeAt === -1) return {};
  const authorityStart = schemeAt + 3;
  const authorityEnd = indexOfFirstOf(url, ['/', '?', '#'], authorityStart);
  const query = querySpan(url, authorityEnd);
  return {
    ...userinfoSpans(url, authorityStart, authorityEnd),
    ...(query !== undefined && { query }),
  };
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

function querySpan(url: string, authorityEnd: number): Span | undefined {
  const queryStart = url.indexOf('?', authorityEnd);
  const fragmentStart = url.indexOf('#', authorityEnd);
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

/** A literal header value has no token to resolve, so nothing was substituted into it. */
const INTERPOLATION_TOKEN = /\{(?:env|path):/u;
