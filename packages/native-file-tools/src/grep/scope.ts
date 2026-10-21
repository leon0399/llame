import { posix } from "node:path";

import { RE2JS } from "re2js";

/** A scope split into the admitted literal prefix and its glob suffix. */
export interface GrepScopeSplit {
  /** Segments before the first segment holding a glob character; ends with '/'. */
  readonly prefix: string;
  /** The glob text from the first glob segment onward; undefined without one. */
  readonly globSuffix: string | undefined;
  /** Whether the submitted path text ended with a separator. */
  readonly endsWithSeparator: boolean;
}

export type GrepScopeSplitResult =
  | GrepScopeSplit
  | { readonly error: "unsupported_glob"; readonly operator: string };

/** A compiled glob suffix over paths relative to the admitted prefix. */
export interface CompiledGlob {
  matchesFile(rel: string): boolean;
  mayDescend(relDir: string): boolean;
}

/** Glob characters the engine honors, plus the ones it refuses. */
const SCOPE_OPERATORS = ["*", "?", "{", "}", "[", "]"] as const;
const UNSUPPORTED_GLOB_CHARACTERS = ["{", "}", "[", "]"] as const;

/** A whole-segment `**`, the only pattern part that spans separators. */
const ANY_SEGMENTS = "any-segments";
type GlobSegment = RE2JS | typeof ANY_SEGMENTS;

/**
 * Split a raw submitted path part (no percent-decoding) at the first segment
 * that holds a glob character. A `{`, `}`, `[`, or `]` is a glob operator the
 * tool refuses, so it starts a suffix too and the refusal names it.
 */
export function splitGrepScope(pathPart: string): GrepScopeSplitResult {
  const segments = pathPart.split("/");
  let offset = 0;
  for (const [position, segment] of segments.entries()) {
    if (!SCOPE_OPERATORS.some((operator) => segment.includes(operator))) {
      offset += segment.length + 1;
      continue;
    }
    const suffix = pathPart.slice(offset);
    const unsupported = UNSUPPORTED_GLOB_CHARACTERS.find((operator) =>
      suffix.includes(operator),
    );
    if (unsupported !== undefined)
      return { error: "unsupported_glob", operator: unsupported };
    return {
      prefix: literalPrefix(segments.slice(0, position)),
      globSuffix: suffix,
      endsWithSeparator: pathPart.endsWith("/"),
    };
  }
  return {
    prefix: pathPart,
    globSuffix: undefined,
    endsWithSeparator: pathPart.endsWith("/"),
  };
}

/** The kept segments as one locator prefix; a removed segment leaves a '/'. */
function literalPrefix(kept: ReadonlyArray<string>): string {
  if (kept.length === 0) return "";
  const joined = kept.join("/");
  const base = joined.length === 0 ? "/" : joined;
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * Lexically resolve a host or Machine scope like `path.posix.resolve`: `.`
 * and `..` segments and repeated separators settle without a filesystem
 * probe, and a trailing separator survives so the prefix keeps its meaning.
 */
export function normalizeHostScope(path: string): string {
  const trailing = path.endsWith("/");
  const resolved = posix.resolve(path);
  return trailing && resolved !== "/" ? `${resolved}/` : resolved;
}

/** Compile a glob suffix into one segment matcher per path segment. */
export function compileGlob(suffix: string): CompiledGlob {
  const trimmed = suffix.endsWith("/") ? suffix.slice(0, -1) : suffix;
  const segments: Array<GlobSegment> =
    trimmed.length === 0 ? [] : trimmed.split("/").map(toGlobSegment);
  return {
    matchesFile: (rel) => matchesWholePath(segments, rel),
    mayDescend: (relDir) =>
      reachableStates(
        segments,
        relDir.length === 0 ? [] : relDir.split("/"),
      ).some((state) => state < segments.length),
  };
}

function toGlobSegment(segment: string): GlobSegment {
  if (segment === "**") return ANY_SEGMENTS;
  return RE2JS.compile(`^${segmentSource(segment)}$`);
}

/** `*` and `?` stay inside one segment; every other character is literal. */
function segmentSource(segment: string): string {
  let source = "";
  for (const character of segment) {
    if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += RE2JS.quote(character);
  }
  return source;
}

function matchesWholePath(
  segments: ReadonlyArray<GlobSegment>,
  rel: string,
): boolean {
  if (rel.length === 0) return false;
  return reachableStates(segments, rel.split("/")).includes(segments.length);
}

/**
 * Every pattern position reachable after consuming the whole path, with
 * `**` allowed to absorb any number of segments (including none).
 */
function reachableStates(
  segments: ReadonlyArray<GlobSegment>,
  parts: ReadonlyArray<string>,
): Array<number> {
  let states = closure(segments, [0]);
  for (const part of parts) states = step(segments, states, part);
  return states;
}

/** Follow `**` without consuming a segment: it may match zero segments. */
function closure(
  segments: ReadonlyArray<GlobSegment>,
  initial: ReadonlyArray<number>,
): Array<number> {
  const reached = [...initial];
  for (let index = 0; index < reached.length; index += 1) {
    const state = reached[index];
    if (state >= segments.length) continue;
    if (segments[state] !== ANY_SEGMENTS) continue;
    if (reached.includes(state + 1)) continue;
    reached.push(state + 1);
  }
  return reached;
}

function step(
  segments: ReadonlyArray<GlobSegment>,
  states: ReadonlyArray<number>,
  part: string,
): Array<number> {
  const next: Array<number> = [];
  for (const state of states) {
    if (state >= segments.length) continue;
    const segment = segments[state];
    if (segment === ANY_SEGMENTS) next.push(state);
    else if (segment.test(part)) next.push(state + 1);
  }
  return closure(segments, next);
}
