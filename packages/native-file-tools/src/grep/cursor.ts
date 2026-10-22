import { createHash } from "node:crypto";

import { isNumber, isRecord, isString } from "@workspace/runtime-safety";

/**
 * A keyset cursor naming the last emitted passage and the inputs it belonged
 * to. `rel` is the file's path relative to its scope prefix, so resume never
 * re-derives a filename from an encoded locator.
 */
export interface GrepPassageCursor {
  readonly kind: "passage";
  readonly scopeIndex: number;
  readonly rel: string;
  readonly startLine: number;
  /** Last line the page emitted of that passage; present only when it cut it. */
  readonly endLine?: number;
  /** The named passage was a file's twentieth, so the file is exhausted. */
  readonly truncated?: true;
  readonly inputHash: string;
}

/**
 * A keyset cursor naming the last entry a stopped walk reached. A later call
 * lists that entry without opening it and resumes after it, except that a
 * directory is descended.
 */
export interface GrepPositionCursor {
  readonly kind: "position";
  readonly scopeIndex: number;
  readonly rel: string;
  readonly inputHash: string;
}

export type DecodedGrepCursor = GrepPassageCursor | GrepPositionCursor;

export type GrepCursorDecodeResult =
  | DecodedGrepCursor
  | { readonly error: "invalid_cursor" };

/** One cursor to encode; a passage cursor without `kind` is the default. */
export type GrepCursorInput =
  | {
      readonly kind?: "passage";
      readonly scopeIndex: number;
      readonly rel: string;
      readonly startLine: number;
      readonly endLine?: number;
      readonly truncated?: true;
      readonly inputHash: string;
    }
  | {
      readonly kind: "position";
      readonly scopeIndex: number;
      readonly rel: string;
      readonly inputHash: string;
    };

/**
 * One cursor point a page can end at, in the shape every caller holds: a
 * passage point carries its start line, a position point names a bare entry.
 */
export interface GrepCursorPoint {
  readonly scopeIndex: number;
  readonly rel: string;
  /** Absent only for a position cursor. */
  readonly startLine?: number;
  readonly endLine?: number;
  readonly capped?: boolean;
}

/** The units a `cursor` property adds to a result, its comma included. */
export const GREP_CURSOR_FIELD_OVERHEAD = ',"cursor":""'.length;

/** A hash of a real cursor's length, standing in for the call's input hash. */
const CURSOR_HASH_PLACEHOLDER = "0".repeat(64);

/**
 * The exact serialized size of the `cursor` field that names this point, so a
 * page can keep that room back before it admits a passage. The encoded cursor
 * is the one a result would carry: a base64url length depends only on the
 * payload's bytes, and every call's hash is a sha256 hex of this length.
 */
export function grepCursorFieldUnits(point: GrepCursorPoint): number {
  const inputHash = CURSOR_HASH_PLACEHOLDER;
  const cursor: GrepCursorInput =
    point.startLine === undefined
      ? {
          kind: "position",
          scopeIndex: point.scopeIndex,
          rel: point.rel,
          inputHash,
        }
      : {
          scopeIndex: point.scopeIndex,
          rel: point.rel,
          startLine: point.startLine,
          endLine: point.endLine,
          truncated: point.capped === true ? true : undefined,
          inputHash,
        };
  return GREP_CURSOR_FIELD_OVERHEAD + encodeGrepCursor(cursor).length;
}

/** The resolved inputs a cursor is only valid against. */
export interface GrepHashInputs {
  readonly patterns: ReadonlyArray<string>;
  readonly literal: boolean;
  readonly ignoreCase: boolean;
  readonly projectedScopes: ReadonlyArray<string>;
  readonly resolvedRoots: ReadonlyArray<string>;
}

/** One opaque page key; base64url so it survives a query string untouched. */
export function encodeGrepCursor(cursor: GrepCursorInput): string {
  const payload =
    cursor.kind === "position"
      ? {
          kind: cursor.kind,
          scopeIndex: cursor.scopeIndex,
          rel: cursor.rel,
          inputHash: cursor.inputHash,
        }
      : {
          kind: "passage" as const,
          scopeIndex: cursor.scopeIndex,
          rel: cursor.rel,
          startLine: cursor.startLine,
          endLine: cursor.endLine,
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
  const { kind, scopeIndex, rel, startLine, endLine, truncated, inputHash } =
    value;
  if (!isNumber(scopeIndex) || !Number.isInteger(scopeIndex)) return undefined;
  if (scopeIndex < 0 || !isString(rel) || !isString(inputHash))
    return undefined;
  if (kind === "position") {
    if (startLine !== undefined || endLine !== undefined) return undefined;
    if (truncated !== undefined) return undefined;
    return { kind, scopeIndex, rel, inputHash };
  }
  if (kind !== "passage") return undefined;
  if (!isNumber(startLine) || !Number.isInteger(startLine)) return undefined;
  if (startLine < 1) return undefined;
  if (endLine !== undefined) {
    if (!isNumber(endLine) || !Number.isInteger(endLine)) return undefined;
    if (endLine < startLine) return undefined;
  }
  if (truncated !== undefined && truncated !== true) return undefined;
  return { kind, scopeIndex, rel, startLine, endLine, truncated, inputHash };
}
