/**
 * The one-line artifact notice a `tool`-shaped spill ends with
 * (tool-result-artifacts "An artifact notice is one bracketed line").
 *
 * The producer owns the inline layout and the omitted content; this module
 * only names the stored parts, the line a reader continues from, and where the
 * host files are. Every value renders on one line, because a line break inside
 * a locator or a directory would start a line the notice does not own.
 */

/** The marker a result carries when its whole rendering was not stored. */
export const ARTIFACT_NOT_STORED = "[full result not stored]";

/** One stored part the notice names. */
export type ArtifactNoticePart = {
  /** The part's locator, such as `artifact://bash-5/stdout`. */
  readonly locator: string;
  /** The part's artifact line count. */
  readonly lines: number;
};

/** Where a reader continues after the inline part. */
export type ArtifactNoticeContinuation = {
  readonly locator: string;
  /** The first artifact line the inline part did not show. */
  readonly next: number;
};

/** The host files of an artifact, when they exist. */
export type ArtifactNoticeHost =
  | { readonly kind: "directory"; readonly directory: string }
  | { readonly kind: "host-only" };

export type ArtifactNoticeOptions = {
  /** `grep` and `web_search` continue from a line; `bash` does not. */
  readonly continueWith?: ArtifactNoticeContinuation;
  readonly host?: ArtifactNoticeHost;
};

/**
 * `[full result: <locator> (<lines> lines); continue with <locator>:<next>-;
 * host files in <directory>]`. One part is `1 line`, two are joined with a
 * comma. An empty part list is a producer bug, so it still renders one
 * bracketed line with no parts rather than throwing inside a tool result.
 */
export function artifactNotice(
  parts: ReadonlyArray<ArtifactNoticePart>,
  options: ArtifactNoticeOptions = {},
): string {
  const named = parts
    .map(
      (part) =>
        `${oneLine(part.locator)} (${part.lines} ${part.lines === 1 ? "line" : "lines"})`,
    )
    .join(", ");
  const continuation =
    options.continueWith === undefined
      ? ""
      : `; continue with ${oneLine(options.continueWith.locator)}:${options.continueWith.next}-`;
  const host =
    options.host === undefined
      ? ""
      : options.host.kind === "directory"
        ? `; host files in ${oneLine(options.host.directory)}`
        : "; host files on the llame host only";
  return `[full result: ${named}${continuation}${host}]`;
}

/** Collapse every line break so a value cannot start a notice line. */
function oneLine(value: string): string {
  return value.replaceAll(/[\r\n]+/gu, " ");
}
