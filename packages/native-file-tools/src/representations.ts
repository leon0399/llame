import { NativeFileError, type ReadTarget } from "./path";
import { outlineMarkdown } from "./markdown-outline";
import type { SingleReadSuccess } from "./source-lines";

export type OutlineReader = (
  lines: AsyncIterable<string> | Iterable<string>,
  target: ReadTarget,
) => Promise<SingleReadSuccess>;

export const OUTLINE_UNSUPPORTED_MESSAGE =
  "The :outline member reads text/markdown content only; read this source without it.";

/** The fixed extension mapping keeps representation selection code-owned. */
export function fileMediaType(path: string): string | undefined {
  return /\.(?:md|markdown|mdown|mkd)$/iu.test(path)
    ? "text/markdown"
    : undefined;
}

const OUTLINE_READERS = {
  "text/markdown": outlineMarkdown,
} as const satisfies Record<string, OutlineReader>;

export function outlineReader(mediaType: string | undefined): OutlineReader {
  const reader =
    mediaType === "text/markdown"
      ? OUTLINE_READERS["text/markdown"]
      : undefined;
  if (reader === undefined)
    throw new NativeFileError("invalid_selector", OUTLINE_UNSUPPORTED_MESSAGE);
  return reader;
}
