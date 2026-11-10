import { splitSourceLines } from '@workspace/native-file-tools';
import { codePointSafeCutIndex } from '@workspace/runtime-safety';

/**
 * Artifact line numbering (tool-result-artifacts D2). A stored part can hold a
 * single source line far longer than a read serves — a one-line JSON `stdout`,
 * or an MCP `text` item — so the reader counts every 8,000-unit piece of such a
 * line as its own line. A piece ends on a code-point boundary, so a UTF-16
 * surrogate pair is never split, and every notice, range, and continuation that
 * names artifact lines uses this same count.
 */
export const ARTIFACT_LINE_UNITS = 8000;

/**
 * The part's text as the reader numbers it: each source line's content, with a
 * line longer than {@link ARTIFACT_LINE_UNITS} split into pieces. Terminators
 * are not part of a piece or of its 8,000-unit count — `\r\n` included, so a
 * CRLF line of 8,000 units stays one line — and {@link artifactText} can join
 * the pieces back.
 */
export function artifactLinePieces(source: string): Array<string> {
  return splitSourceLines(source).flatMap((line) =>
    splitCodeUnits(lineBody(line)),
  );
}

/** One source line without its terminator; a lone `\r` stays content. */
function lineBody(line: string): string {
  if (line.endsWith('\r\n')) return line.slice(0, -2);

  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

/**
 * The text whose lines are the artifact's lines: the pieces joined by a line
 * terminator, with the source's own final terminator kept. An LF source
 * without a line over the bound reproduces exactly; a pieced line becomes one
 * line per piece, which is what the shared read selectors then number, and a
 * CRLF terminator renders as the LF between lines.
 */
export function artifactText(source: string): string {
  const text = artifactLinePieces(source).join('\n');

  return source.endsWith('\n') ? `${text}\n` : text;
}

/** How many artifact lines the part's text holds. */
export function artifactLineCount(source: string): number {
  return artifactLinePieces(source).length;
}

/**
 * How many artifact lines one rendered line takes: at least one, because the
 * reader counts the blank separator between two passages as a line too.
 */
export function artifactLinePieceCount(line: string): number {
  return line.length <= ARTIFACT_LINE_UNITS ? 1 : splitCodeUnits(line).length;
}

function splitCodeUnits(body: string): Array<string> {
  if (body.length <= ARTIFACT_LINE_UNITS) return [body];
  const pieces = new Array<string>();
  let start = 0;

  while (start < body.length) {
    const end = codePointSafeCutIndex(
      body,
      Math.min(start + ARTIFACT_LINE_UNITS, body.length),
    );

    pieces.push(body.slice(start, end));
    start = end;
  }

  return pieces;
}
