import { createHash } from "node:crypto";

import { isNumber, isRecord, isString } from "@workspace/runtime-safety";

/**
 * A keyset cursor naming the last emitted passage and the inputs it belonged
 * to. `rel` is the file's path relative to its scope prefix, so resume never
 * re-derives a filename from an encoded locator.
 */
export interface DecodedGrepCursor {
  readonly scopeIndex: number;
  readonly rel: string;
  readonly startLine: number;
  /** The named passage was a file's twentieth, so the file is exhausted. */
  readonly truncated?: true;
  readonly inputHash: string;
}

export type GrepCursorDecodeResult =
  | DecodedGrepCursor
  | { readonly error: "invalid_cursor" };

/** The resolved inputs a cursor is only valid against. */
export interface GrepHashInputs {
  readonly patterns: ReadonlyArray<string>;
  readonly literal: boolean;
  readonly ignoreCase: boolean;
  readonly projectedScopes: ReadonlyArray<string>;
  readonly resolvedRoots: ReadonlyArray<string>;
}

/** One opaque page key; base64url so it survives a query string untouched. */
export function encodeGrepCursor(cursor: DecodedGrepCursor): string {
  const payload = {
    scopeIndex: cursor.scopeIndex,
    rel: cursor.rel,
    startLine: cursor.startLine,
    truncated: cursor.truncated,
    inputHash: cursor.inputHash,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode a cursor; anything malformed or issued for other inputs is refused. */
export function decodeGrepCursor(
  text: string,
  inputHash: string,
): GrepCursorDecodeResult {
  if (!/^[\w-]+$/.test(text)) return { error: "invalid_cursor" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return { error: "invalid_cursor" };
  }
  const cursor = readCursor(parsed);
  if (cursor === undefined || cursor.inputHash !== inputHash)
    return { error: "invalid_cursor" };
  return cursor;
}

/** Hash the resolved inputs so a later call with other inputs cannot resume. */
export function hashGrepInputs(inputs: GrepHashInputs): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        patterns: inputs.patterns,
        literal: inputs.literal,
        ignoreCase: inputs.ignoreCase,
        projectedScopes: inputs.projectedScopes,
        resolvedRoots: inputs.resolvedRoots,
      }),
      "utf8",
    )
    .digest("hex");
}

function readCursor(value: unknown): DecodedGrepCursor | undefined {
  if (!isRecord(value)) return undefined;
  const { scopeIndex, rel, startLine, truncated, inputHash } = value;
  if (!isNumber(scopeIndex) || !Number.isInteger(scopeIndex)) return undefined;
  if (scopeIndex < 0 || !isString(rel)) return undefined;
  if (!isNumber(startLine) || !Number.isInteger(startLine)) return undefined;
  if (startLine < 1 || !isString(inputHash)) return undefined;
  if (truncated !== undefined && truncated !== true) return undefined;
  return { scopeIndex, rel, startLine, truncated, inputHash };
}
