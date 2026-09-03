/**
 * One source message's logical lines. Offsets are JavaScript UTF-16 code-unit
 * offsets so they can be handed back to the source text without re-encoding.
 */
export type ConversationLogicalLine = {
  line: number;
  text: string;
  delimiter: string;
  startOffset: number;
  endOffsetExclusive: number;
};

/**
 * Scan a source string using the Knowledge/file-reader line contract: LF
 * terminates a line, CRLF is one delimiter, lone CR remains source text,
 * blank lines count, and a terminal delimiter does not create a phantom line.
 */
export function scanConversationLogicalLines(
  text: string,
): Array<ConversationLogicalLine> {
  const lines: Array<ConversationLogicalLine> = [];
  let lineStart = 0;
  let line = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    const hasCr = index > lineStart && text.charCodeAt(index - 1) === 13;
    const endOffsetExclusive = hasCr ? index - 1 : index;
    lines.push({
      line,
      text: text.slice(lineStart, endOffsetExclusive),
      delimiter: hasCr ? '\r\n' : '\n',
      startOffset: lineStart,
      endOffsetExclusive,
    });
    line += 1;
    lineStart = index + 1;
  }

  if (lineStart < text.length) {
    lines.push({
      line,
      text: text.slice(lineStart),
      delimiter: '',
      startOffset: lineStart,
      endOffsetExclusive: text.length,
    });
  }

  return lines;
}
