/**
 * Detection of JS-style regex literals (`/pattern/flags`) inside arbitrary
 * message text, tuned for precision over recall: division expressions, file
 * paths, URLs, dates, and `//` comments must never be flagged, at the cost of
 * missing metachar-free literals like `/abc/`.
 *
 * Detection only ever *compiles* a candidate (`new RegExp`) to validate it —
 * it never executes one against text. Execution happens solely in the tester
 * UI, against input the viewer typed.
 */

export interface RegexCandidate {
  /** Offset of the opening `/` within the scanned text. */
  start: number;
  /** Offset just past the last flag char. */
  end: number;
  /** The full literal as written, `/pattern/flags`. */
  source: string;
  /** The pattern body, without delimiters. */
  pattern: string;
  /** The flags string (possibly empty). */
  flags: string;
}

const FLAG_CHARS = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);

// A char that rules out regex-literal position when it directly precedes the
// opening slash: identifiers/numbers (division, `and/or`), `)`/`]` (division
// off a call or index), `.` (method chains, filenames), `/` and `:` (paths,
// URLs, comments).
const BLOCKING_PREFIX = /[\w.)\]/:]/;

// Evidence the body is meant as a pattern. A lone unescaped `.` is too weak —
// `/example.com/` and `/4.5/` read as prose, not regex.
const STRONG_METACHAR = /[\\^$|?*+()[{}]/;

const WORD_CHAR = /\w/;

/**
 * Scans the closing `/` of a candidate body starting just past the opening
 * slash. Escape-aware and character-class-aware: an unescaped `/` inside
 * `[…]` does not terminate the literal. Returns the index of the closing
 * slash, or -1 when the literal never closes on this line.
 */
const findClosingSlash = (line: string, bodyStart: number): number => {
  let inClass = false;

  for (let i = bodyStart; i < line.length; i += 1) {
    const char = line[i];

    if (char === "\\") {
      i += 1;
      continue;
    }

    if (inClass) {
      if (char === "]") {
        inClass = false;
      }
      continue;
    }

    if (char === "[") {
      inClass = true;
      continue;
    }

    if (char === "/") {
      return i;
    }
  }

  return -1;
};

const scanLine = (
  line: string,
  lineOffset: number,
  out: RegexCandidate[],
): void => {
  let i = 0;

  while (i < line.length) {
    if (line[i] !== "/") {
      i += 1;
      continue;
    }

    const before = i === 0 ? "" : line[i - 1];

    if (before && BLOCKING_PREFIX.test(before)) {
      i += 1;
      continue;
    }

    const close = findClosingSlash(line, i + 1);

    if (close === -1) {
      // This opener never closes, but a later one still can — an unclosed
      // `[` here may have swallowed a slash a later scan reads differently.
      i += 1;
      continue;
    }

    const body = line.slice(i + 1, close);

    let flagsEnd = close + 1;
    const seenFlags = new Set<string>();
    let duplicateFlag = false;

    while (flagsEnd < line.length && FLAG_CHARS.has(line[flagsEnd])) {
      if (seenFlags.has(line[flagsEnd])) {
        duplicateFlag = true;
        break;
      }
      seenFlags.add(line[flagsEnd]);
      flagsEnd += 1;
    }

    const flags = line.slice(close + 1, flagsEnd);
    const after = flagsEnd < line.length ? line[flagsEnd] : "";

    const plausible =
      body.length > 0 &&
      !duplicateFlag &&
      !/^\s|\s$/.test(body) &&
      STRONG_METACHAR.test(body) &&
      // A word char right after the flags means this run was never a flags
      // list at all (`/path/to`), so the "literal" is a coincidence.
      !(after && WORD_CHAR.test(after));

    if (plausible && compiles(body, flags)) {
      out.push({
        start: lineOffset + i,
        end: lineOffset + flagsEnd,
        source: line.slice(i, flagsEnd),
        pattern: body,
        flags,
      });
      i = flagsEnd;
      continue;
    }

    i += 1;
  }
};

const compiles = (pattern: string, flags: string): boolean => {
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
};

export interface RegexEvaluation {
  matched: boolean;
  /** Matched spans within the input, sorted, non-overlapping. */
  ranges: Array<{ start: number; end: number }>;
  /** The matched substrings, one per range. */
  values: string[];
}

const MAX_MATCHES = 50;

/**
 * Evaluates a pattern against viewer-typed input for the tester UI. A global
 * pattern reports every (non-empty) match; otherwise the first. Returns
 * `null` for empty input or a pattern that does not compile.
 */
export const evaluateRegex = (
  pattern: string,
  flags: string,
  input: string,
): RegexEvaluation | null => {
  if (!input) {
    return null;
  }

  let regex: RegExp;

  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return null;
  }

  const ranges: RegexEvaluation["ranges"] = [];
  const values: string[] = [];

  if (regex.global) {
    for (const match of input.matchAll(regex)) {
      if (match[0] === "") {
        continue;
      }
      ranges.push({ start: match.index, end: match.index + match[0].length });
      values.push(match[0]);
      if (values.length >= MAX_MATCHES) {
        break;
      }
    }
  } else {
    const match = regex.exec(input);

    if (match && match[0] !== "") {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      values.push(match[0]);
    }
  }

  return { matched: values.length > 0, ranges, values };
};

/**
 * Finds every plausible regex literal in `text`. Literals never span lines;
 * offsets are relative to the start of `text`.
 */
export const findRegexCandidates = (text: string): RegexCandidate[] => {
  const out: RegexCandidate[] = [];
  let lineOffset = 0;

  for (const line of text.split("\n")) {
    if (line.includes("/")) {
      scanLine(line, lineOffset, out);
    }
    lineOffset += line.length + 1;
  }

  return out;
};
