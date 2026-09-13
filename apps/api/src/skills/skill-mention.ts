/**
 * Explicit `$skill` mention recognition (system-provided-skills D5).
 *
 * Mentions come only from user-authored text. Assistant output, quoted tool
 * results, attachments, and system reminders are never scanned, because a
 * skill load is a consequence of what the *user* asked for — not of anything a
 * model or a tool wrote back.
 *
 * Recognition is deliberately narrow. A `$name` token inside a fenced code
 * block, inside an inline code span, or written as `\$name` is an example or a
 * literal, not a request.
 */

import { isValidSkillName } from './skill-name';

/** The name characters the grammar admits, for boundary scanning. */
const NAME_CHARACTER = /[a-z0-9-]/u;

export type SkillMention = {
  readonly name: string;
  /** Zero-based index of the `$` in the source text. */
  readonly index: number;
};

/**
 * Distinct skills named in first-mention order.
 *
 * A repeated mention loads the skill once: the turn's selection set is a set,
 * and loading twice would double-persist an activation for one intent.
 */
export function parseSkillMentions(text: string): ReadonlyArray<SkillMention> {
  const mentions: Array<SkillMention> = [];
  const seen = new Set<string>();

  for (const region of scanCodeRegions(text)) {
    // Boundary scanning needs the character before the region start, so a
    // mention immediately after an inline code span is still seen as preceded
    // by code (and therefore not at a boundary).
    for (const index of dollarPositions(text, region)) {
      const name = matchedName(text, index);
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      mentions.push({ name, index });
    }
  }
  return mentions;
}

/** One index where a `$` appears outside code and is not backslash-escaped. */
function* dollarPositions(
  text: string,
  region: { readonly start: number; readonly end: number },
): Generator<number> {
  let index = region.start;
  while (index < region.end) {
    if (text[index] !== '$') {
      index += 1;
      continue;
    }
    if (isEscaped(text, index)) {
      index += 1;
      continue;
    }
    yield index;
    index += 1;
  }
}

/** An odd number of immediately preceding backslashes escapes the character. */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && text[cursor] === '\\';
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * The complete skill name introduced at `index`, or `undefined`.
 *
 * The maximal run of name characters is taken and then validated whole, so a
 * name is never matched as a prefix of a longer token: `$pdf2` is either the
 * skill `pdf2` or nothing, never `pdf` followed by a stray `2`. A trailing name
 * character that makes the run invalid (a trailing hyphen, a doubled hyphen)
 * therefore yields no mention rather than a shorter valid one.
 */
function matchedName(text: string, index: number): string | undefined {
  if (index > 0 && isNameBoundary(text[index - 1])) return undefined;
  let end = index + 1;
  while (end < text.length && NAME_CHARACTER.test(text[end])) end += 1;
  if (end === index + 1) return undefined;
  const name = text.slice(index + 1, end);
  if (!isValidSkillName(name)) return undefined;
  if (!isMentionableName(name)) return undefined;
  // The run already consumed every name character, so the following character
  // is a boundary by construction.
  return name;
}

/**
 * A narrowing of the catalog's name grammar for MENTION purposes only: at
 * least one lowercase letter.
 *
 * The Agent Skills grammar permits an all-digit name, so `costs $5` would
 * otherwise name a skill and emit a `not_found` failure item into the
 * conversation — a spurious notice on ordinary prose about a quantity. The cost
 * of narrowing is that a package literally named `5` cannot be selected by
 * mention; it stays advertised and readable at `skill://5`, so nothing is
 * unreachable. A leading-digit name like `2fa` still matches, which is why the
 * rule is "contains a letter" rather than "starts with one".
 */
function isMentionableName(name: string): boolean {
  return /[a-z]/u.test(name);
}

/** A preceding name character or `$` glues the token to its context. */
function isNameBoundary(character: string): boolean {
  return NAME_CHARACTER.test(character) || character === '$';
}

/**
 * The spans of `text` that are NOT code.
 *
 * Fenced blocks open on a line whose first non-space run is three or more
 * backticks or tildes and close on a line whose first non-space run is at least
 * as long, of the same character. Inline code opens on a run of N backticks and
 * closes on the next run of exactly N, so an inner run of a different length
 * stays part of the span.
 */
function* scanCodeRegions(
  text: string,
): Generator<{ readonly start: number; readonly end: number }> {
  const state: ScanState = { plainStart: 0, fence: undefined };
  let cursor = 0;

  while (cursor < text.length) {
    const lineEnd = nextLineEnd(text, cursor);
    const fenceMatch = fenceMarker(text, cursor, lineEnd);
    const kind = classifyLine(state, fenceMatch);
    if (kind === 'opens-fence') {
      // Everything before this line is plain; the fence line onward is code.
      yield { start: state.plainStart, end: cursor };
      state.fence = fenceMatch;
      cursor = lineEnd;
      continue;
    }
    if (kind === 'closes-fence') {
      state.fence = undefined;
      cursor = lineEnd;
      state.plainStart = cursor;
      continue;
    }

    const spanEnd =
      state.fence === undefined
        ? inlineCodeEnd(text, cursor, lineEnd)
        : undefined;
    if (spanEnd !== undefined) {
      yield { start: state.plainStart, end: cursor };
      state.plainStart = spanEnd;
      cursor = spanEnd;
      continue;
    }
    cursor = lineEnd;
  }

  if (state.fence === undefined) {
    yield { start: state.plainStart, end: text.length };
  }
}

type ScanState = {
  plainStart: number;
  fence: { readonly marker: string; readonly length: number } | undefined;
};

/** What one line does to the fence state. */
function classifyLine(
  state: ScanState,
  fenceMatch: { readonly marker: string; readonly length: number } | undefined,
): 'opens-fence' | 'closes-fence' | 'plain' {
  if (state.fence === undefined) {
    return fenceMatch === undefined ? 'plain' : 'opens-fence';
  }
  if (
    fenceMatch !== undefined &&
    fenceMatch.marker === state.fence.marker &&
    fenceMatch.length >= state.fence.length
  ) {
    return 'closes-fence';
  }
  return 'plain';
}

function nextLineEnd(text: string, from: number): number {
  const newline = text.indexOf('\n', from);
  return newline < 0 ? text.length : newline + 1;
}

/** The fence marker opening or closing a line, when that line is fence-shaped. */
function fenceMarker(
  text: string,
  lineStart: number,
  lineEnd: number,
): { readonly marker: string; readonly length: number } | undefined {
  const line = text.slice(lineStart, lineEnd).trim();
  const match = /^(`{3,}|~{3,})/u.exec(line);
  if (match === null) return undefined;
  // A closing fence carries no info string; an opening one may. Neither
  // distinction matters here — any fence-shaped line toggles the state.
  const marker = match[1][0];
  return { marker, length: match[1].length };
}

/**
 * The index just past an inline code span opening in `[from, lineEnd)`, or
 * `undefined` when the line segment holds no complete span.
 *
 * Fence lines are handled by the caller, so a line-initial backtick run is not
 * mistaken for one here.
 */
function inlineCodeEnd(
  text: string,
  from: number,
  lineEnd: number,
): number | undefined {
  let cursor = from;
  while (cursor < lineEnd) {
    if (text[cursor] !== '`') {
      cursor += 1;
      continue;
    }
    let runEnd = cursor;
    while (runEnd < lineEnd && text[runEnd] === '`') runEnd += 1;
    const length = runEnd - cursor;
    const closing = findBacktickRun(text, runEnd, length);
    if (closing === undefined) return undefined;
    return closing + length;
  }
  return undefined;
}

/** The start of the next run of EXACTLY `length` backticks at or after `from`. */
function findBacktickRun(
  text: string,
  from: number,
  length: number,
): number | undefined {
  let cursor = from;
  while (cursor < text.length) {
    if (text[cursor] !== '`') {
      cursor += 1;
      continue;
    }
    let runEnd = cursor;
    while (runEnd < text.length && text[runEnd] === '`') runEnd += 1;
    if (runEnd - cursor === length) return cursor;
    cursor = runEnd;
  }
  return undefined;
}
