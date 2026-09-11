import { RE2JS } from 're2js';

import { PERMISSION_LIMITS, PermissionCompileError } from './limits';
import { type CompiledValueMatcher } from './types';

/**
 * ECMAScript `\s` as an explicit RE2 class: tabs/newlines, space, the Unicode
 * spaces, and the byte-order mark. RE2's own `\s` is narrower, so a literal
 * Bash `command` clause must not rely on it.
 */
const BASH_WHITESPACE_RUN = String.raw`[\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]+`;

const WHITESPACE_TEST = /\s/u;

function assertPatternSize(pattern: string, configPath: string): void {
  const bytes = Buffer.byteLength(pattern, 'utf8');
  if (bytes > PERMISSION_LIMITS.maxPatternBytes) {
    throw new PermissionCompileError(
      configPath,
      `pattern exceeds ${PERMISSION_LIMITS.maxPatternBytes} UTF-8 bytes`,
    );
  }
}

/** Case-sensitive substring search; regex metacharacters stay literal. */
export function compileLiteralMatcher(
  literal: string,
  configPath: string,
): CompiledValueMatcher {
  assertPatternSize(literal, configPath);
  const exact = RE2JS.compile(RE2JS.quote(literal));
  const flexible = RE2JS.compile(escapeBashWhitespace(literal));
  return {
    kind: 'literal',
    matchesExact: (value) => exact.test(value),
    matchesFlexibleWhitespace: (value) => flexible.test(value),
  };
}

/**
 * Bounded RE2-compatible unanchored search. Unsupported syntax (for example a
 * backreference or lookbehind) fails compilation; execution never falls back
 * to a backtracking engine.
 */
export function compileRegexMatcher(
  pattern: string,
  configPath: string,
): CompiledValueMatcher {
  assertPatternSize(pattern, configPath);
  let compiled: RE2JS;
  try {
    compiled = RE2JS.compile(pattern);
  } catch {
    throw new PermissionCompileError(
      configPath,
      'invalid or unsupported regex',
    );
  }
  return {
    kind: 'regex',
    matchesExact: (value) => compiled.test(value),
    matchesFlexibleWhitespace: (value) => compiled.test(value),
  };
}

/** Escape every non-whitespace run and widen each whitespace run to `\s+`. */
function escapeBashWhitespace(literal: string): string {
  return literal
    .split(/(\s+)/u)
    .map((part) =>
      part.length === 0
        ? ''
        : WHITESPACE_TEST.test(part)
          ? BASH_WHITESPACE_RUN
          : RE2JS.quote(part),
    )
    .join('');
}
