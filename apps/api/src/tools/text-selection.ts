import {
  NativeFileError,
  outlineReader,
  resolveEndRelativeSelector,
  selectMultiRangeLines,
  selectSourceLines,
  splitSourceLines,
  type ReadSuccess,
  type ReadTarget,
} from '@workspace/native-file-tools';

import { type ToolResult } from './types';

/**
 * One in-memory source read, the shape every reader of already-held text
 * shares: the SSH read, the web read, and the artifact read all number lines
 * of a string they hold rather than of a file. The target's end-relative
 * members resolve against `lineCount`, which the caller may know already (a
 * stored artifact line count) or count from the text.
 */
export type InMemoryTextSelection = {
  readonly target: ReadTarget;
  readonly text: string;
  readonly lineCount: number;
  readonly mediaType: string | undefined;
};

export async function selectInMemoryText({
  target,
  text,
  lineCount,
  mediaType,
}: InMemoryTextSelection): Promise<ReadSuccess> {
  const resolved =
    target.pending === undefined
      ? target
      : resolveEndRelativeSelector(target, lineCount);
  if (resolved.outline)
    return await outlineReader(mediaType)(splitSourceLines(text), resolved);
  return resolved.ranges === undefined
    ? selectSourceLines(text, resolved, mediaType)
    : selectMultiRangeLines(text, resolved, mediaType);
}

/** The error result a rendering helper threw, when it is a native refusal. */
export function nativeErrorResult(error: unknown): ToolResult | undefined {
  if (!(error instanceof NativeFileError)) return undefined;
  return { status: 'error', type: error.type, message: error.message };
}
