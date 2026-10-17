/**
 * Root-level GFM table recognition over the Markdown scanner's decided lines.
 *
 * The scanner stays the authority for headings, sections, and outlines, so
 * this tracker reads only the lines it decided and layers tables on top
 * (proposal T4): a line CommonMark decided is heading text, container content,
 * HTML, a fence, or code is never a table row, and a setext underline always
 * wins.
 *
 * Only root tables are recognized (proposal T1). The tracker answers one
 * question per decided line: when that line is a body row of an open root
 * table, which header row and delimiter row does the row belong to?
 */

import {
  ATX,
  expandTabs,
  fenceOpen,
  htmlStartKind,
  listItemStart,
  stripTerminator,
  THEMATIC,
} from "./markdown-syntax";
import type { MarkdownLine } from "./markdown-structure";

/** The header row and delimiter row of the table a line is a body row of. */
export type RootTableHeaderPair = {
  header: MarkdownLine;
  delimiter: MarkdownLine;
};

/** A block GFM continues past the line that ended a table, so no table may
 *  start inside it: a list whose items lazily swallow later lines, or a type-7
 *  HTML block, which runs to the next blank line. */
type Suppression =
  | {
      kind: "list";
      /** Columns an item's content starts at. */
      required: number;
      /** The item has an open paragraph, so an unindented line continues it. */
      lazy: boolean;
      /** A blank line closed that paragraph; the item resumes only at the
       *  content column. */
      afterBlank: boolean;
    }
  | { kind: "html" };

/** One native line measured the way the scanner measures it: tabs expanded to
 *  columns and the terminator removed. */
type MeasuredLine = {
  body: string;
  /** Columns before the first non-space character. */
  indent: number;
  /** The line from that column on. */
  content: string;
  blank: boolean;
};

const BLANK_FIELD = /^[ \t]*$/u;
const DELIMITER_CELL = /^[ \t]*:?-+:?[ \t]*$/u;
const MAX_ROW_INDENT = 3;

function measureLine(text: string): MeasuredLine {
  const body = expandTabs(stripTerminator(text));
  let indent = 0;
  while (body[indent] === " ") indent += 1;
  return {
    body,
    indent,
    content: body.slice(indent),
    blank: indent >= body.length,
  };
}

/** A row's cells: split at every pipe not escaped by an odd number of
 *  backslashes, including pipes inside code spans, then drop an edge field
 *  that holds only spaces or tabs. A row of one pipe therefore has no cells. */
function rowCells(text: string, firstLine: boolean): Array<string> {
  const body = stripTerminator(firstLine ? text.replace(/^\uFEFF/u, "") : text);
  const fields: Array<string> = [];
  let field = "";
  let escapes = 0;
  let pipes = 0;
  for (const char of body) {
    if (char === "|" && escapes % 2 === 0) {
      fields.push(field);
      field = "";
      escapes = 0;
      pipes += 1;
      continue;
    }
    escapes = char === "\\" ? escapes + 1 : 0;
    field += char;
  }
  fields.push(field);
  if (pipes > 0) {
    if (BLANK_FIELD.test(fields[0] ?? "")) fields.shift();
    if (BLANK_FIELD.test(fields.at(-1) ?? "")) fields.pop();
  }
  return fields;
}

/** A block that closes an open paragraph: an ATX heading, a fence, a thematic
 *  break, or a type-1 to type-6 HTML block. A blockquote, a list item,
 *  indented code, and a lone type-7 HTML line do not, since none of them
 *  interrupts a paragraph. */
function startsInterruptingBlock(measured: MeasuredLine): boolean {
  if (ATX.test(measured.content)) return true;
  if (fenceOpen(measured.content) !== undefined) return true;
  if (THEMATIC.test(measured.content)) return true;
  const html = htmlStartKind(measured.content, true);
  return html > 0 && html !== 7;
}

/** Whether a non-blank line starts a block GFM ends a table on instead of
 *  reading it as a body row. */
function startsBlock(measured: MeasuredLine): boolean {
  if (measured.indent > MAX_ROW_INDENT) return true;
  if (measured.content.startsWith(">")) return true;
  if (listItemStart(measured.body, 0, measured.indent, false) !== undefined)
    return true;
  if (startsInterruptingBlock(measured)) return true;
  return htmlStartKind(measured.content, true) === 7;
}

export class MarkdownRootTableTracker {
  private candidate: { line: MarkdownLine; cells: number } | undefined;
  private table: RootTableHeaderPair | undefined;
  private suppression: Suppression | undefined;

  /** Consumes one decided line; returns the enclosing table's header pair when
   *  the line is one of that table's body rows. */
  accept(line: MarkdownLine): RootTableHeaderPair | undefined {
    const measured = measureLine(line.text);
    const rootText =
      line.role === "content" &&
      line.rootParagraph === true &&
      measured.indent <= MAX_ROW_INDENT;
    if (this.table !== undefined) {
      if (line.role !== "heading" && !measured.blank && !startsBlock(measured))
        return this.table;
      this.table = undefined;
      this.candidate = undefined;
      this.suppression = this.followingBlock(measured, rootText);
      return undefined;
    }
    const suppression = this.suppression;
    if (suppression !== undefined) {
      const next = this.followSuppression(suppression, measured);
      this.suppression = next;
      if (next !== undefined) return undefined;
    }
    return this.open(line, measured, rootText);
  }

  /** The block a table-ending line starts, when GFM keeps later lines in it.
   *  A line the scanner already decided is container content needs none: the
   *  scanner reports the lines that follow it as container content too. */
  private followingBlock(
    measured: MeasuredLine,
    rootText: boolean,
  ): Suppression | undefined {
    if (measured.blank || !rootText) return undefined;
    const item = listItemStart(measured.body, 0, measured.indent, false);
    if (item !== undefined)
      return {
        kind: "list",
        required: item.required,
        lazy: measured.body.slice(item.offset).trim() !== "",
        afterBlank: false,
      };
    if (htmlStartKind(measured.content, true) === 7) return { kind: "html" };
    // A root paragraph line blocks a table only as a GFM-only list item or as a
    // type-7 HTML line: every other block start leaves the line non-root.
    return undefined;
  }

  /** The suppression in force after this line, or `undefined` once the block
   *  that carries it has ended. */
  private followSuppression(
    suppression: Suppression,
    measured: MeasuredLine,
  ): Suppression | undefined {
    if (suppression.kind === "html")
      return measured.blank ? undefined : suppression;
    if (measured.blank) return { ...suppression, afterBlank: true };
    const paragraphOpen = suppression.lazy && !suppression.afterBlank;
    const relativeIndent = measured.indent - suppression.required;
    if (relativeIndent >= 0)
      return relativeIndent > MAX_ROW_INDENT
        ? { ...suppression, lazy: paragraphOpen, afterBlank: false }
        : {
            ...suppression,
            lazy: !startsInterruptingBlock(measured),
            afterBlank: false,
          };
    // A thematic break ends the list; a line indented past a row's limit only
    // continues the open paragraph, since indented code cannot interrupt one.
    if (measured.indent <= MAX_ROW_INDENT && THEMATIC.test(measured.content))
      return undefined;
    if (measured.indent > MAX_ROW_INDENT && paragraphOpen) return suppression;
    const item = listItemStart(measured.body, 0, measured.indent, false);
    if (item !== undefined) {
      const lazy = measured.body.slice(item.offset).trim() !== "";
      return { kind: "list", required: item.required, lazy, afterBlank: false };
    }
    if (startsBlock(measured)) {
      if (htmlStartKind(measured.content, true) !== 7) return undefined;
      // A lone type-7 line cannot interrupt an open item paragraph, so it stays
      // in the item; with no paragraph open it starts a root HTML block, which
      // then runs to the next blank line.
      return paragraphOpen
        ? { ...suppression, lazy: false, afterBlank: false }
        : { kind: "html" };
    }
    if (suppression.afterBlank || !suppression.lazy) return undefined;
    return suppression;
  }

  /** Opens a table when this row and the following delimiter row agree. A row
   *  is never a line that starts a block GFM resolves as its own: a list item,
   *  a lone type-7 HTML line, or an interrupting heading, fence, or break. */
  private open(
    line: MarkdownLine,
    measured: MeasuredLine,
    rootText: boolean,
  ): RootTableHeaderPair | undefined {
    if (!rootText || startsBlock(measured)) {
      this.candidate = undefined;
      return undefined;
    }
    const cells = rowCells(line.text, line.line === 1);
    const candidate = this.candidate;
    if (
      candidate !== undefined &&
      cells.length > 0 &&
      cells.length === candidate.cells &&
      cells.every((cell) => DELIMITER_CELL.test(cell))
    ) {
      this.table = { header: candidate.line, delimiter: line };
      this.candidate = undefined;
      return undefined;
    }
    this.candidate = { line, cells: cells.length };
    return undefined;
  }
}
