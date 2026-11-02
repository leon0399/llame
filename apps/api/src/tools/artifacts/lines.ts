import { splitSourceLines } from '@workspace/native-file-tools';

/**
 * Artifact line numbering (tool-result-artifacts D2). A stored part can hold a
 * single source line far longer than a read serves — a one-line JSON `stdout`,
 * or an MCP `text` item — so the reader counts every 8,000-unit piece of such a
 * line as its own line. A piece ends on a code-point boundary, so a UTF-16
 * surrogate pair is never split, and every notice, range, and continuation that
 * names artifact lines uses this same count.
 */
export const ARTIFACT_LINE_UNITS = 8000;

// The low half of a UTF-16 surrogate pair (0xDC00–0xDFFF).
const LOW_SURROGATE_START = 56_320;
const LOW_SURROGATE_END = 57_343;

/**
 * The part's text as the reader numbers it: each source line's content, with a
 * line longer than {@link ARTIFACT_LINE_UNITS} split into pieces. Terminators
 * are not part of a piece, so {@link artifactText} can join the pieces back.
 */
export function artifactLinePieces(source: string): Array<string> {
  return splitSourceLines(source).flatMap((line) =>
    splitCodeUnits(line.endsWith('\n') ? line.slice(0, -1) : line),
  );
}

/**
 * The text whose lines are the artifact's lines: the pieces joined by a line
 * terminator, with the source's own final terminator kept. A part without a
 * line over the bound reproduces its source exactly; a pieced line becomes one
 * line per piece, which is what the shared read selectors then number.
 */
export function artifactText(source: string): string {
  const text = artifactLinePieces(source).join('\n');
  return source.endsWith('\n') ? `${text}\n` : text;
}

/** How many artifact lines the part's text holds. */
export function artifactLineCount(source: string): number {
  return artifactLinePieces(source).length;
}

function splitCodeUnits(body: string): Array<string> {
  if (body.length <= ARTIFACT_LINE_UNITS) return [body];
  const pieces = new Array<string>();
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + ARTIFACT_LINE_UNITS, body.length);
    // A cut between a high and a low surrogate would break the pair, so the
    // boundary moves one unit back and the low surrogate opens the next piece.
    if (
      end < body.length &&
      body.charCodeAt(end) >= LOW_SURROGATE_START &&
      body.charCodeAt(end) <= LOW_SURROGATE_END
    )
      end -= 1;
    pieces.push(body.slice(start, end));
    start = end;
  }
  return pieces;
}
