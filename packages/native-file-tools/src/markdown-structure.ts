/**
 * One-pass CommonMark block scanner that reports root-level heading and
 * frontmatter structure over native LF lines.
 *
 * It follows the CommonMark block phase (container matching, block starts,
 * lazy continuation) closely enough to decide which lines are root headings,
 * and does no inline parsing: heading lines are reported verbatim.
 *
 * Memory is the open container chain (capped at MAX_CONTAINER_DEPTH), the
 * open-heading stack, and the lines whose meaning a later line decides: an
 * open root paragraph (a setext underline may turn it into a heading), the
 * text of any paragraph that opens with `[` (link reference definitions
 * decide where a setext heading starts), and the lines after a line-one
 * `---` until a closer makes them frontmatter or `end()` replays them as
 * Markdown. Those lines are reported only once decided.
 */

import {
  advance,
  ATX,
  closesFence,
  consumeQuoteMarker,
  type Container,
  continues,
  type Cursor,
  definitionLineCount,
  expandTabs,
  fenceOpen,
  HTML_CLOSE,
  htmlStartKind,
  isDelimiter,
  listItemStart,
  SETEXT,
  stripTerminator,
  THEMATIC,
} from "./markdown-syntax";

/** `blank` is a whitespace-only native line; container markers such as `>`
 *  alone are `content`. */
export type MarkdownLineRole = "blank" | "content" | "heading" | "frontmatter";

export type MarkdownHeading = {
  /** 1-6 for headings, 0 for frontmatter. */
  depth: number;
  /** One-based native line where the heading starts. */
  line: number;
  /** One-based native line of the heading's last line (setext underline). */
  headEnd: number;
  /** Native line `line` without its line terminator. */
  label: string;
};

export type MarkdownLine = {
  line: number;
  /** The native line exactly as pushed. */
  text: string;
  role: MarkdownLineRole;
  /** The root heading this line belongs to when `role` is `heading`. */
  heading?: MarkdownHeading;
};

export type MarkdownSpan = MarkdownHeading & {
  kind: "heading" | "frontmatter";
  /** Last native line of the section: the line before the next root heading
   *  of the same or a shallower depth, else the last line. */
  endLine: number;
};

export type MarkdownScanHandlers = {
  /** Called once per native line in source order; `false` stops the scan. */
  onLine?: (line: MarkdownLine) => boolean | void;
  /** Called when a span's end is known (close order); `false` stops the scan. */
  onSpan?: (span: MarkdownSpan) => boolean | void;
};

export type MarkdownScanner = {
  /** Feeds the next native line; returns `false` once the scan has stopped. */
  push(nativeLine: string): boolean;
  /** Settles deferred lines and closes every open span. */
  end(): void;
};

type Entry = MarkdownLine & {
  /** Physical lines of this native line still awaiting a decision. */
  pending: number;
};

type Paragraph = {
  type: "paragraph";
  root: boolean;
  /** Entries of a root paragraph's lines, one per physical line. */
  lines: Array<Entry>;
  /** Stripped line text of a paragraph that opens with `[`; link reference
   *  definitions decide whether and where a setext underline applies. */
  definitionText: Array<string> | undefined;
};

type Leaf =
  | Paragraph
  | { type: "fence"; char: string; length: number }
  | { type: "indented" }
  | { type: "html"; kind: number };

const BYTE_ORDER_MARK = /^\uFEFF/u;

/** Container blocks nested deeper than this are read as paragraph text, so
 *  hostile nesting cannot make one line cost quadratic time. CommonMark sets
 *  no limit; real documents stay far below it. */
const MAX_CONTAINER_DEPTH = 64;

type LineState = {
  entry: Entry;
  cursor: Cursor;
  matched: number;
  containersMatched: boolean;
  leafMatched: boolean;
  /** No open block is left unmatched by this line. */
  allClosed: boolean;
  /** The last matched block is an open paragraph. */
  paragraphContainer: boolean;
};

function leafContinues(leaf: Leaf, cursor: Cursor): boolean {
  switch (leaf.type) {
    case "fence":
      return true;
    case "indented":
      return cursor.indent >= 4 || cursor.blank;
    case "html":
      return !(cursor.blank && leaf.kind >= 6);
    case "paragraph":
      return !cursor.blank;
  }
}

class Scanner implements MarkdownScanner {
  private stopped = false;
  private lineCount = 0;
  private frontmatter: Array<string> | undefined;
  private queue: Array<Entry> = [];
  /** Index of the first unreported entry; avoids O(n) shifts while a long
   *  root paragraph is deferred. */
  private queueHead = 0;
  private readonly containers: Array<Container> = [];
  private leaf: Leaf | undefined;
  private readonly headings: Array<MarkdownHeading> = [];

  constructor(private readonly handlers: MarkdownScanHandlers) {}

  push(nativeLine: string): boolean {
    if (this.stopped) return false;
    this.lineCount += 1;
    if (this.frontmatter) {
      this.frontmatter.push(nativeLine);
      if (isDelimiter(nativeLine, true)) this.closeFrontmatter();
    } else if (
      this.lineCount === 1 &&
      isDelimiter(nativeLine.replace(BYTE_ORDER_MARK, ""), false)
    ) {
      this.frontmatter = [nativeLine];
    } else {
      this.scanLine(this.lineCount, nativeLine);
    }
    return !this.stopped;
  }

  end(): void {
    if (this.stopped) return;
    const unclosed = this.frontmatter;
    this.frontmatter = undefined;
    unclosed?.forEach((text, index) => {
      if (!this.stopped) this.scanLine(index + 1, text);
    });
    this.closeLeaf();
    this.flush();
    while (!this.stopped && this.headings.length > 0) {
      const heading = this.headings.pop();
      if (heading) this.emitHeadingSpan(heading, this.lineCount);
    }
  }

  private closeFrontmatter(): void {
    const lines = this.frontmatter ?? [];
    this.frontmatter = undefined;
    for (const [index, text] of lines.entries()) {
      if (this.stopped) return;
      this.stop(
        this.handlers.onLine?.({ line: index + 1, text, role: "frontmatter" }),
      );
    }
    if (this.stopped) return;
    const closer = lines.length;
    this.stop(
      this.handlers.onSpan?.({
        kind: "frontmatter",
        depth: 0,
        line: 1,
        headEnd: closer,
        endLine: closer,
        label: stripTerminator(lines[0] ?? ""),
      }),
    );
  }

  private stop(result: boolean | void): void {
    if (result === false) this.stopped = true;
  }

  private scanLine(line: number, text: string): void {
    const entry: Entry = { line, text, role: "blank", pending: 0 };
    this.queue.push(entry);
    // Decoding keeps a leading BOM in the text; CommonMark ignores it.
    const body = line === 1 ? text.replace(BYTE_ORDER_MARK, "") : text;
    for (const physical of stripTerminator(body).split("\r")) {
      if (this.stopped) return;
      this.scanPhysical(entry, expandTabs(physical));
    }
    this.flush();
  }

  /** Records a decided role; the first heading on a native line wins. */
  private mark(
    entry: Entry,
    role: "content" | "heading",
    heading?: MarkdownHeading,
  ): void {
    if (entry.role === "heading") return;
    entry.role = role;
    if (heading) entry.heading = heading;
  }

  private flush(): void {
    while (!this.stopped) {
      const head = this.queue[this.queueHead];
      if (!head || head.pending > 0) break;
      this.queueHead += 1;
      const event: MarkdownLine = {
        line: head.line,
        text: head.text,
        role: head.role,
      };
      if (head.heading) event.heading = head.heading;
      this.stop(this.handlers.onLine?.(event));
    }
    if (this.queueHead === this.queue.length) {
      this.queue = [];
      this.queueHead = 0;
    }
  }

  private emitHeadingSpan(heading: MarkdownHeading, endLine: number): void {
    this.stop(this.handlers.onSpan?.({ kind: "heading", ...heading, endLine }));
  }

  private openHeading(heading: MarkdownHeading): void {
    while (!this.stopped) {
      const last = this.headings.at(-1);
      if (!last || last.depth < heading.depth) break;
      this.headings.pop();
      this.emitHeadingSpan(last, Math.max(heading.line - 1, last.headEnd));
    }
    this.headings.push(heading);
  }

  private closeLeaf(): void {
    const leaf = this.leaf;
    this.leaf = undefined;
    if (leaf?.type !== "paragraph") return;
    for (const entry of leaf.lines) {
      this.mark(entry, "content");
      entry.pending -= 1;
    }
  }

  /** Closes unmatched blocks and the leaf, and marks the parent, before a
   *  new block is added. */
  private addBlock(state: LineState): void {
    this.closeUnmatched(state);
    this.closeLeaf();
    const parent = this.containers.at(-1);
    if (parent?.type === "item") parent.hasChild = true;
  }

  private addParagraphLine(entry: Entry, text: string): void {
    const paragraph = this.leaf;
    if (paragraph?.type !== "paragraph") return;
    paragraph.definitionText?.push(text);
    if (!paragraph.root) {
      this.mark(entry, "content");
      return;
    }
    paragraph.lines.push(entry);
    entry.pending += 1;
  }

  /** Turns the open paragraph into a setext heading; false when link
   *  reference definitions consume all of it. */
  private setext(entry: Entry, depth: number): boolean {
    const paragraph = this.leaf;
    if (paragraph?.type !== "paragraph") return false;
    const texts = paragraph.definitionText;
    const consumed = texts ? definitionLineCount(texts) : 0;
    if (texts && consumed >= texts.length) return false;
    this.leaf = undefined;
    if (!paragraph.root) {
      this.mark(entry, "content");
      return true;
    }
    const first = paragraph.lines[consumed] ?? entry;
    const heading: MarkdownHeading = {
      depth,
      line: first.line,
      headEnd: entry.line,
      label: stripTerminator(first.text),
    };
    paragraph.lines.forEach((line, index) => {
      if (index < consumed) this.mark(line, "content");
      else this.mark(line, "heading", heading);
      line.pending -= 1;
    });
    this.mark(entry, "heading", heading);
    this.openHeading(heading);
    return true;
  }

  // Mirrors the CommonMark reference parser's incorporateLine: match open
  // containers, try block starts, then lazy continuation or leaf content.
  private scanPhysical(entry: Entry, line: string): void {
    const state: LineState = {
      entry,
      cursor: { line, offset: 0, next: 0, indent: 0, blank: true },
      matched: 0,
      containersMatched: false,
      leafMatched: false,
      allClosed: false,
      paragraphContainer: false,
    };
    this.matchContainers(state);
    if (this.matchLeaf(state)) return;
    const acceptsLines =
      state.containersMatched &&
      state.leafMatched &&
      this.leaf !== undefined &&
      this.leaf.type !== "paragraph";
    if (!acceptsLines && this.openBlocks(state)) return;
    this.addContent(state);
  }

  private matchContainers(state: LineState): void {
    for (const container of this.containers) {
      advance(state.cursor);
      if (!continues(container, state.cursor)) break;
      state.matched += 1;
    }
    state.containersMatched = state.matched === this.containers.length;
  }

  /** Returns true when the line closed a fenced code block. */
  private matchLeaf(state: LineState): boolean {
    const leaf = this.leaf;
    if (state.containersMatched && leaf) {
      advance(state.cursor);
      if (leaf.type === "fence" && closesFence(leaf, state.cursor)) {
        this.leaf = undefined;
        this.mark(state.entry, "content");
        return true;
      }
      state.leafMatched = leafContinues(leaf, state.cursor);
    }
    state.allClosed =
      state.containersMatched && (leaf === undefined || state.leafMatched);
    state.paragraphContainer =
      state.containersMatched &&
      state.leafMatched &&
      leaf?.type === "paragraph";
    return false;
  }

  private closeUnmatched(state: LineState): void {
    if (state.allClosed) return;
    if (!(state.containersMatched && state.leafMatched)) this.closeLeaf();
    this.containers.length = state.matched;
    state.allClosed = true;
  }

  /** An unmatched open paragraph that this line would continue lazily. */
  private lazyParagraph(state: LineState): boolean {
    return (
      !state.allClosed && !state.cursor.blank && this.leaf?.type === "paragraph"
    );
  }

  /** Returns true when a block start consumed the whole line. */
  private openBlocks(state: LineState): boolean {
    for (;;) {
      const outcome = this.openBlock(state);
      if (outcome === "done") return true;
      if (outcome === "leaf") return false;
      if (outcome === "none") {
        state.cursor.offset = state.cursor.next;
        return false;
      }
      state.paragraphContainer = false;
    }
  }

  private openBlock(state: LineState): "container" | "leaf" | "done" | "none" {
    const cursor = state.cursor;
    advance(cursor);
    if (cursor.indent >= 4) return this.openIndentedCode(state);
    const rest = cursor.line.slice(cursor.next);
    const depth = state.allClosed ? this.containers.length : state.matched;
    const nestable = depth < MAX_CONTAINER_DEPTH;
    if (nestable && rest[0] === ">") {
      consumeQuoteMarker(cursor);
      this.addContainer(state, { type: "quote" });
      return "container";
    }
    const leaf = this.openLeafBlock(state, rest);
    if (leaf !== "none") return leaf;
    const item = nestable
      ? listItemStart(
          cursor.line,
          cursor.offset,
          cursor.next,
          state.paragraphContainer,
        )
      : undefined;
    if (!item) return "none";
    cursor.offset = item.offset;
    this.addContainer(state, {
      type: "item",
      required: item.required,
      hasChild: false,
    });
    return "container";
  }

  private openLeafBlock(
    state: LineState,
    rest: string,
  ): "leaf" | "done" | "none" {
    const atx = ATX.exec(rest);
    if (atx) {
      this.addAtxHeading(state, atx[1]?.length ?? 1);
      return "done";
    }
    const fence = fenceOpen(rest);
    if (fence) {
      this.addLeaf(state, { type: "fence", ...fence });
      return "leaf";
    }
    const interrupts = state.paragraphContainer || this.lazyParagraph(state);
    const html = htmlStartKind(rest, !interrupts);
    if (html > 0) {
      this.addLeaf(state, { type: "html", kind: html });
      return "leaf";
    }
    if (state.paragraphContainer && SETEXT.test(rest)) {
      this.closeUnmatched(state);
      if (this.setext(state.entry, rest[0] === "=" ? 1 : 2)) return "done";
    }
    if (THEMATIC.test(rest)) {
      this.addBlock(state);
      this.mark(state.entry, "content");
      return "done";
    }
    return "none";
  }

  private openIndentedCode(state: LineState): "leaf" | "none" {
    if (this.leaf?.type === "paragraph" || state.cursor.blank) return "none";
    this.addLeaf(state, { type: "indented" });
    return "leaf";
  }

  private addContainer(state: LineState, container: Container): void {
    this.addBlock(state);
    this.containers.push(container);
  }

  private addLeaf(state: LineState, leaf: Leaf): void {
    this.addBlock(state);
    this.leaf = leaf;
    state.cursor.offset = state.cursor.next;
  }

  private addAtxHeading(state: LineState, depth: number): void {
    this.addBlock(state);
    const entry = state.entry;
    if (this.containers.length > 0) {
      this.mark(entry, "content");
      return;
    }
    const heading: MarkdownHeading = {
      depth,
      line: entry.line,
      headEnd: entry.line,
      label: stripTerminator(entry.text),
    };
    this.mark(entry, "heading", heading);
    this.openHeading(heading);
  }

  private addContent(state: LineState): void {
    const { cursor, entry } = state;
    const text = cursor.line.slice(cursor.offset);
    if (this.lazyParagraph(state)) {
      this.addParagraphLine(entry, text);
      return;
    }
    this.closeUnmatched(state);
    const leaf = this.leaf;
    if (leaf?.type === "paragraph") {
      this.addParagraphLine(entry, text);
      return;
    }
    if (!leaf && !cursor.blank) {
      this.addBlock(state);
      this.leaf = {
        type: "paragraph",
        root: this.containers.length === 0,
        lines: [],
        definitionText: text.startsWith("[") ? [] : undefined,
      };
      this.addParagraphLine(entry, text);
      return;
    }
    if (/[^ ]/.test(cursor.line)) this.mark(entry, "content");
    if (
      leaf?.type === "html" &&
      leaf.kind <= 5 &&
      HTML_CLOSE[leaf.kind - 1]?.test(text)
    ) {
      this.leaf = undefined;
    }
  }
}

export function createMarkdownScanner(
  handlers: MarkdownScanHandlers,
): MarkdownScanner {
  return new Scanner(handlers);
}

/** Reports root heading and frontmatter spans as each one closes. */
export function scanMarkdownStructure(
  lines: Iterable<string>,
  onSpan: (span: MarkdownSpan) => boolean | void,
): void {
  const scanner = createMarkdownScanner({ onSpan });
  for (const line of lines) {
    if (!scanner.push(line)) return;
  }
  scanner.end();
}
