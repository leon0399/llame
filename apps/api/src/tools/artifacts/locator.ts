/**
 * The `artifact://` locator grammar (tool-result-artifacts D1, D2).
 *
 * `artifact://<toolName>-<n>` names one artifact of the current Chat, and
 * `artifact://<toolName>-<n>/<part>` names one part of it. `toolName` is a
 * tool's registered name, so it uses the same token shape a tool id does;
 * `<n>` is the Chat's counter value.
 */

export const ARTIFACT_SCHEME = 'artifact';

export type ArtifactLocator = {
  readonly toolName: string;
  readonly seq: number;
  /** The stream name inside the artifact, or undefined for the artifact. */
  readonly part: string | undefined;
};

/** A registered tool name and a stream name share this token shape. */
const NAME_SOURCE = String.raw`[A-Za-z0-9][A-Za-z0-9_-]*`;
const NAME = new RegExp(`^${NAME_SOURCE}$`, 'u');
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

/** Whether a value is a well-formed tool or stream name in a locator. */
export function isLocatorName(value: string): boolean {
  return NAME.test(value);
}

/** Parse the text after `artifact://`; undefined for a malformed locator. */
export function parseArtifactLocator(
  rest: string,
): ArtifactLocator | undefined {
  const match = LOCATOR.exec(rest);
  if (match === null) return undefined;
  const [, toolName, seq, part] = match;
  return { toolName, seq: Number(seq), part };
}

/** Parse a whole `artifact://` locator; undefined when the scheme is absent. */
export function parseArtifactLocatorText(
  text: string,
): ArtifactLocator | undefined {
  const prefix = `${ARTIFACT_SCHEME}://`;
  return text.startsWith(prefix)
    ? parseArtifactLocator(text.slice(prefix.length))
    : undefined;
}
