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
  for (const [type, reader] of Object.entries(OUTLINE_READERS)) {
    if (type === mediaType) return reader;
  }
  throw new NativeFileError("invalid_selector", OUTLINE_UNSUPPORTED_MESSAGE);
}
