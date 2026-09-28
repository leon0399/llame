/**
 * CommonMark block-level syntax tests used by the Markdown structure scanner.
 * Lines reaching these helpers have tabs expanded to spaces, so indentation
 * is measured in columns and whitespace checks only see spaces.
 */

export const ATX = /^(#{1,6})(?: +|$)/;
export const FENCE_OPEN = /^(?:`{3,}(?!.*`)|~{3,})/;
export const FENCE_CLOSE = /^(?:`{3,}|~{3,})(?= *$)/;
export const SETEXT = /^(?:=+|-+) *$/;
export const THEMATIC = /^(?:(?:\* *){3,}|(?:_ *){3,}|(?:- *){3,})$/;
const BULLET = /^[*+-]/;
const ORDERED = /^(\d{1,9})[.)]/;

const TAG_NAME = "[A-Za-z][A-Za-z0-9-]*";
const ATTRIBUTE =
  "(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^\"'=<>`\\x00-\\x20]+|'[^']*'|\"[^\"]*\"))?)";
const HTML_OPEN: ReadonlyArray<RegExp> = [
  /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
  /^<!--/,
  /^<[?]/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i,
  new RegExp(
    `^(?:<${TAG_NAME}${ATTRIBUTE}*\\s*/?>|</${TAG_NAME}\\s*>)\\s*$`,
    "i",
  ),
];
export const HTML_CLOSE: ReadonlyArray<RegExp> = [
  /<\/(?:script|pre|textarea|style)>/i,
  /-->/,
  /\?>/,
  />/,
  /\]\]>/,
];

/** Removes the LF terminator and one CR before it. */
export function stripTerminator(text: string): string {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.endsWith("\r") ? body.slice(0, -1) : body;
}

export function isDelimiter(text: string, closer: boolean): boolean {
  const content = stripTerminator(text).replace(/[ \t]+$/, "");
  return content === "---" || (closer && content === "...");
}

/** Tabs advance to the next multiple of four columns (CommonMark tab stops). */
export function expandTabs(line: string): string {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const char of line) {
    out += char === "\t" ? " ".repeat(4 - (out.length % 4)) : char;
  }
  return out;
}

export function htmlStartKind(
  rest: string,
  mayInterruptParagraph: boolean,
): number {
  const last = mayInterruptParagraph ? HTML_OPEN.length : HTML_OPEN.length - 1;
  for (let index = 0; index < last; index += 1) {
    if (HTML_OPEN[index]?.test(rest)) return index + 1;
  }
  return 0;
}

function skipSpaceNewline(text: string, start: number): number {
  let position = start;
  while (text[position] === " ") position += 1;
  if (text[position] === "\n") position += 1;
  while (text[position] === " ") position += 1;
  return position;
}

function lineEndAfter(text: string, start: number): number {
  let position = start;
  while (text[position] === " ") position += 1;
  if (position === text.length) return position;
  return text[position] === "\n" ? position + 1 : -1;
}

function labelEnd(text: string, start: number): number {
  let position = start + 1;
  let visible = false;
  while (position < text.length && position - start <= 1000) {
    const char = text[position];
    if (char === "]") return visible ? position + 1 : -1;
    if (char === "[") return -1;
    if (char === "\\" && position + 1 < text.length) position += 1;
    if (!/\s/.test(char ?? "")) visible = true;
    position += 1;
  }
  return -1;
}

function destinationEnd(text: string, start: number): number {
  if (text[start] === "<") {
    const match = /^<(?:[^<>\n\\]|\\.)*>/.exec(text.slice(start));
    return match ? start + match[0].length : -1;
  }
  let position = start;
  let depth = 0;
  while (position < text.length) {
    const char = text[position] ?? "";
    if (char === "\\" && /[!-/:-@[-`{-~]/.test(text[position + 1] ?? "")) {
      position += 2;
    } else if (char === "(") {
      depth += 1;
      position += 1;
    } else if (char === ")") {
      if (depth === 0) break;
      depth -= 1;
      position += 1;
    } else if (char <= " " || char === "\x7f") {
      break;
    } else {
      position += 1;
    }
  }
  if (position === start || depth !== 0) return -1;
  return position;
}

function titleEnd(text: string, start: number): number {
  const match =
    /^(?:"(?:\\[\s\S]|[^\\"])*"|'(?:\\[\s\S]|[^\\'])*'|\((?:\\[\s\S]|[^\\()])*\))/.exec(
      text.slice(start),
    );
  return match ? start + match[0].length : -1;
}

/** End of one link reference definition at `start`, or -1. */
function definitionEnd(text: string, start: number): number {
  const afterLabel = labelEnd(text, start);
  if (afterLabel < 0 || text[afterLabel] !== ":") return -1;
  const destination = skipSpaceNewline(text, afterLabel + 1);
  const afterDestination = destinationEnd(text, destination);
  if (afterDestination < 0) return -1;
  const titleStart = skipSpaceNewline(text, afterDestination);
  if (titleStart !== afterDestination) {
    const afterTitle = titleEnd(text, titleStart);
    const end = afterTitle < 0 ? -1 : lineEndAfter(text, afterTitle);
    if (end >= 0) return end;
  }
  return lineEndAfter(text, afterDestination);
}

/** Number of leading lines that link reference definitions consume. */
export function definitionLineCount(lines: Array<string>): number {
  const text = lines.join("\n");
  let position = 0;
  while (text[position] === "[") {
    const end = definitionEnd(text, position);
    if (end < 0) break;
    position = end;
  }
  if (position >= text.length) return lines.length;
  let count = 0;
  for (let index = 0; index < position; index += 1) {
    if (text[index] === "\n") count += 1;
  }
  return count;
}

export type ListItem = { offset: number; required: number };

export function listItemStart(
  line: string,
  offset: number,
  next: number,
  interruptsParagraph: boolean,
): ListItem | undefined {
  const rest = line.slice(next);
  const bullet = BULLET.exec(rest);
  const ordered = bullet ? null : ORDERED.exec(rest);
  if (!bullet && (!ordered || (interruptsParagraph && ordered[1] !== "1"))) {
    return undefined;
  }
  const markerLength = (bullet ?? ordered)?.[0].length ?? 0;
  const markerEnd = next + markerLength;
  if (markerEnd < line.length && line[markerEnd] !== " ") return undefined;
  if (interruptsParagraph && line.slice(markerEnd).trim() === "") {
    return undefined;
  }
  let position = markerEnd + 1;
  while (position - markerEnd < 5 && line[position] === " ") position += 1;
  const spaces = position - markerEnd;
  const markerOffset = next - offset;
  if (spaces >= 5 || position >= line.length) {
    const contentStart = line[markerEnd] === " " ? markerEnd + 1 : markerEnd;
    return { offset: contentStart, required: markerOffset + markerLength + 1 };
  }
  return { offset: position, required: markerOffset + markerLength + spaces };
}

export type Cursor = {
  line: string;
  offset: number;
  /** First non-space position at or after `offset`. */
  next: number;
  indent: number;
  blank: boolean;
};

export function advance(cursor: Cursor): void {
  cursor.next = cursor.offset;
  while (cursor.line[cursor.next] === " ") cursor.next += 1;
  cursor.indent = cursor.next - cursor.offset;
  cursor.blank = cursor.next >= cursor.line.length;
}

export function consumeQuoteMarker(cursor: Cursor): void {
  cursor.offset = cursor.next + 1;
  if (cursor.line[cursor.offset] === " ") cursor.offset += 1;
}

export function closesFence(
  fence: { char: string; length: number },
  cursor: Cursor,
): boolean {
  if (cursor.indent >= 4) return false;
  const close = FENCE_CLOSE.exec(cursor.line.slice(cursor.next));
  return (
    close !== null &&
    close[0][0] === fence.char &&
    close[0].length >= fence.length
  );
}

/** Open container blocks: a blockquote, or a list item whose content starts
 *  `required` columns in. */
export type Container =
  | { type: "quote" }
  | { type: "item"; required: number; hasChild: boolean };

/** Consumes the container prefix when this line continues the container. */
export function continues(container: Container, cursor: Cursor): boolean {
  if (container.type === "quote") {
    if (cursor.indent >= 4 || cursor.line[cursor.next] !== ">") return false;
    consumeQuoteMarker(cursor);
    return true;
  }
  if (cursor.blank) {
    if (!container.hasChild) return false;
    cursor.offset = cursor.next;
    return true;
  }
  if (cursor.indent < container.required) return false;
  cursor.offset += container.required;
  return true;
}
