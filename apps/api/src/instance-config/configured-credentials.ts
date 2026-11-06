import type { InterpolationResult } from '@workspace/config-interpolation';
import { normalizeProtectedValues } from '@workspace/runtime-safety';

import type { LlameConfig } from './llame-config';

/**
 * The gate every member must pass. A value shorter than 16 characters, or
 * with a low estimated entropy, is accepted as a leak: redacting short or
 * common text would corrupt unrelated output, and llame cannot tell a weak
 * configured secret from an ordinary word.
 */
const MINIMUM_MEMBER_LENGTH = 16;
const MINIMUM_MEMBER_BITS = 64;

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
 * names one. Only the positions the proposal promises contribute: a provider,
 * web search engine, or web adapter secret; the document leaves of a
 * `{path:…|json:…}` substitution those fields select; the substitutions of
 * provider and remote MCP headers and stdio MCP environment values; and the
 * `POSTGRES_URL` password and `PGPASSWORD` from the loader's environment.
 */
export class ConfiguredCredentialCollector {
  private readonly members: Array<string> = [];

  /** Seeds the members read from the environment the loader was given. */
  constructor(env: NodeJS.ProcessEnv) {
    const databasePassword = postgresPassword(env.POSTGRES_URL);
    this.add(databasePassword);
    if (databasePassword !== undefined) {
      this.add(percentDecoded(databasePassword));
    }
    this.add(env.PGPASSWORD);
  }

  /** `onResolved` hook for a credential field (a provider, engine, or adapter secret). */
  readonly onSecret = (result: InterpolationResult): void =>
    this.addSecret(result);

  /**
   * A credential field: the whole resolved value, and the credential leaves of
   * any selected JSON document. A substitution inside the field is deliberately
   * NOT a member on its own, so `secret-prefix-{env:VERSION}-suffix` does not
   * make `1` a member.
   */
  addSecret(result: InterpolationResult): void {
    this.add(result.value);
    for (const substitution of result.substituted) {
      for (const leaf of substitution.documentLeaves) this.add(leaf);
    }
  }

  /**
   * Every substitution of a header or stdio environment value, excluding `:-`
   * fallback text (a default written in the file is not a secret), plus the
   * credential leaves of a selected JSON document. Literal text around a
   * substitution is never a member.
   */
  addSubstitutions(result: InterpolationResult): void {
    for (const substitution of result.substituted) {
      if (substitution.fallback) continue;
      this.add(substitution.value);
      for (const leaf of substitution.documentLeaves) this.add(leaf);
    }
  }

  /** Normalized (deduped, longest first) and deeply frozen. */
  snapshot(): ReadonlyArray<string> {
    return Object.freeze(normalizeProtectedValues(this.members));
  }

  private add(value: string | undefined): void {
    if (value === undefined || !passesGate(value)) return;
    this.members.push(value);
  }
}

/**
 * Whether `value` is long enough and varied enough to redact. The estimate is
 * the value's length times the Shannon entropy of its own character
 * distribution; it is not a measure of how the value was generated.
 */
function passesGate(value: string): boolean {
  const characters = Array.from(value);
  if (characters.length < MINIMUM_MEMBER_LENGTH) return false;
  return estimatedEntropyBits(characters) >= MINIMUM_MEMBER_BITS;
}

function estimatedEntropyBits(characters: ReadonlyArray<string>): number {
  const counts = new Map<string, number>();
  for (const character of characters) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let bitsPerCharacter = 0;
  for (const count of counts.values()) {
    const frequency = count / characters.length;
    bitsPerCharacter -= frequency * Math.log2(frequency);
  }
  return characters.length * bitsPerCharacter;
}

/**
 * The password of a `POSTGRES_URL`, read from the raw string so multi-host and
 * socket connection strings that `new URL` rejects still yield it: after
 * `scheme://`, the userinfo ends at the last `@` before the first `/`, `?`, or
 * the end of the string, and the password follows the first `:` in that
 * userinfo.
 */
function postgresPassword(databaseUrl: string | undefined): string | undefined {
  if (databaseUrl === undefined) return undefined;
  const schemeEnd = databaseUrl.indexOf('://');
  if (schemeEnd === -1) return undefined;
  const authorityStart = schemeEnd + '://'.length;
  const authorityEnd = firstDelimiter(databaseUrl, authorityStart);
  const userinfoEnd = databaseUrl.lastIndexOf('@', authorityEnd - 1);
  if (userinfoEnd < authorityStart) return undefined;
  const colon = databaseUrl.indexOf(':', authorityStart);
  if (colon === -1 || colon > userinfoEnd) return undefined;
  return databaseUrl.slice(colon + 1, userinfoEnd);
}

/** The index of the first `/`, `?`, or the end of the string at or after `from`. */
function firstDelimiter(value: string, from: number): number {
  const slash = value.indexOf('/', from);
  const query = value.indexOf('?', from);
  if (slash === -1) return query === -1 ? value.length : query;
  if (query === -1) return slash;
  return Math.min(slash, query);
}

function percentDecoded(value: string): string | undefined {
  if (!value.includes('%')) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
