import { RE2JS } from "re2js";

import { GREP_LIMITS } from "./limits";

/** Whether a line matched, or the probe ended its tests before an answer. */
export type GrepLineMatch = boolean | "stopped";

/** One call's compiled disjunction; a line matches when any pattern matches. */
export interface CompiledGrepPatterns {
  readonly count: number;
  /**
   * Whether any pattern matches. `stopped` is asked between two pattern tests,
   * so a long line's tests can end at the call deadline. A stopped line is
   * reported as such, never as a miss: the caller ends the file as stopped, so
   * a match the line still held is not silently lost.
   */
  matches(line: string, stopped?: () => boolean): GrepLineMatch;
}

export type GrepPatternCompileResult =
  | { readonly ok: true; readonly compiled: CompiledGrepPatterns }
  | { readonly ok: false; readonly index: number; readonly message: string };

export interface GrepPatternOptions {
  readonly patterns: ReadonlyArray<string>;
  readonly literal: boolean;
  readonly ignoreCase: boolean;
}

/**
 * Compile the submitted patterns with RE2 syntax. The caller validates the
 * submitted shape; the engine re-asserts its own bounds so a later caller
 * cannot hand it an unbounded list.
 */
export function compileGrepPatterns(
  options: GrepPatternOptions,
): GrepPatternCompileResult {
  const countError = patternCountError(options.patterns.length);

  if (countError !== undefined) return countError;

  const matchers: Array<RE2JS> = [];

  for (const [index, pattern] of options.patterns.entries()) {
    const sizeError = patternSizeError(pattern, index);

    if (sizeError !== undefined) return sizeError;
    const compiled = compileOne(pattern, index, options);

    if (!compiled.ok) return compiled;
    matchers.push(compiled.value);
  }

  return {
    ok: true,
    compiled: {
      count: matchers.length,
      matches: (line, stopped) => {
        for (const [index, matcher] of matchers.entries()) {
          // Nothing to check before the first test: one pattern has no gap.
          if (index > 0 && stopped?.() === true) return "stopped";

          if (matcher.test(line)) return true;
        }

        return false;
      },
    },
  };
}

function patternCountError(
  count: number,
): Extract<GrepPatternCompileResult, { ok: false }> | undefined {
  if (count >= 1 && count <= GREP_LIMITS.maxPatterns) return undefined;

  return {
    ok: false,
    index: count === 0 ? 0 : GREP_LIMITS.maxPatterns,
    message: `patterns must hold 1 to ${GREP_LIMITS.maxPatterns} entries`,
  };
}

function patternSizeError(
  pattern: string,
  index: number,
): Extract<GrepPatternCompileResult, { ok: false }> | undefined {
  if (Buffer.byteLength(pattern, "utf8") <= GREP_LIMITS.maxPatternBytes)
    return undefined;

  return {
    ok: false,
    index,
    message: `pattern exceeds ${GREP_LIMITS.maxPatternBytes} UTF-8 bytes`,
  };
}

function compileOne(
  pattern: string,
  index: number,
  options: GrepPatternOptions,
): { ok: true; value: RE2JS } | { ok: false; index: number; message: string } {
  // `quote` runs first so a literal pattern keeps its metacharacters; the
  // case flag is a prefix so it cannot be quoted away.
  const source = options.literal ? RE2JS.quote(pattern) : pattern;

  try {
    return {
      ok: true,
      value: RE2JS.compile(options.ignoreCase ? `(?i)${source}` : source),
    };
  } catch (error) {
    return {
      ok: false,
      index,
      message: error instanceof Error ? error.message : "invalid pattern",
    };
  }
}
