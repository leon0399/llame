import { parsePathScheme } from '@workspace/native-file-tools';

import { TOOL_ID_PATTERN } from '../tool-id';

/**
 * The `artifact://` locator grammar (tool-result-artifacts D1, D2).
 *
 * `artifact://<toolName>-<n>` names one artifact of the current Chat, and
 * `artifact://<toolName>-<n>/<part>` names one part of it. `toolName` is a
 * tool's registered name, so it uses the same token shape a tool id does;
 * `<n>` is the Chat's counter value, bounded by a Postgres `integer` so neither
 * a read nor a fork's cast can overflow.
 */

export const ARTIFACT_SCHEME = 'artifact';

/** The largest `<n>` a Postgres `integer` column holds. */
const ARTIFACT_SEQ_MAX = 2_147_483_647;

export type ArtifactLocator = {
  readonly toolName: string;
  readonly seq: number;
  /** The stream name inside the artifact, or undefined for the artifact. */
  readonly part: string | undefined;
};

/** A registered tool name and a stream name share the tool-id token shape. */
const NAME_SOURCE = TOOL_ID_PATTERN.source.slice(1, -1);

const LOCATOR = new RegExp(
  `^(${NAME_SOURCE})-([1-9]\\d*)(?:/(${NAME_SOURCE}))?$`,
  'u',
);

export function formatArtifactLocator(
  toolName: string,
  seq: number,
  part?: string,
): string {
  const locator = `${ARTIFACT_SCHEME}://${toolName}-${seq}`;

  return part === undefined || part === '' ? locator : `${locator}/${part}`;
}

/**
 * Parse `<scheme>://<name>-<n>[/<member>]`. The scheme check is
 * case-insensitive, as every other locator reader's is, so
 * `ARTIFACT://grep-1` resolves like `artifact://grep-1`. The `job://` grammar
 * is this one with another scheme.
 */
export function parseNumberedLocator(
  expectedScheme: string,
  text: string,
): { name: string; seq: number; member: string | undefined } | undefined {
  const scheme = parsePathScheme(text);

  if (scheme?.scheme !== expectedScheme) return undefined;
  const match = LOCATOR.exec(scheme.rest);

  if (match === null) return undefined;
  const seq = Number(match[2]);

  if (seq > ARTIFACT_SEQ_MAX) return undefined;

  return { name: match[1], seq, member: match[3] };
}

/** Parse a whole `artifact://` locator. */
export function parseArtifactLocatorText(
  text: string,
): ArtifactLocator | undefined {
  const parsed = parseNumberedLocator(ARTIFACT_SCHEME, text);

  return parsed === undefined
    ? undefined
    : { toolName: parsed.name, seq: parsed.seq, part: parsed.member };
}

/**
 * Whether a value is one well-formed `artifact://` locator: the grammar above
 * in its canonical spelling. Stored jsonb is untrusted on the way back in, so a
 * replay, a settle, or a projection accepts a locator only through this check.
 */
export function isArtifactLocator(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = parseArtifactLocatorText(value);

  return (
    parsed !== undefined &&
    formatArtifactLocator(parsed.toolName, parsed.seq, parsed.part) === value
  );
}
