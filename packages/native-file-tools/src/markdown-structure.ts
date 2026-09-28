/**
 * One-pass CommonMark block scanner that reports root-level heading and
 * frontmatter structure over native LF lines.
 *
 * It follows the CommonMark block phase (container matching, block starts,
 * lazy continuation) closely enough to decide which lines are root headings,
 * and does no inline parsing: heading lines are reported verbatim. Memory is
 * the open container chain, the open-heading stack, and two deferred runs
 * whose meaning a later line decides: the lines of an open root paragraph
 * (a setext underline may turn them into a heading) and the lines after a
 * line-one `---` (a closer makes them frontmatter).
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
  FENCE_OPEN,
  HTML_CLOSE,
  htmlStartKind,
  isDelimiter,
  listItemStart,
  SETEXT,
  stripTerminator,
  THEMATIC,
} from "./markdown-syntax";

export type MarkdownLineRole = "blank" | "content" | "heading" | "frontmatter";

export type MarkdownHeading = {
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

export type MarkdownSpan = {
  kind: "heading" | "frontmatter";
  /** 1-6 for headings, 0 for frontmatter. */
  depth: number;
  line: number;
  headEnd: number;
  /** Last native line of the section: the line before the next root heading
   *  of the same or a shallower depth, else the last line. */
  endLine: number;
  label: string;
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

type Entry = {
  line: number;
  text: string;
  role: MarkdownLineRole;
  heading?: MarkdownHeading;
  /** Physical lines of this native line still awaiting a decision. */
  pending: number;
  pushed: boolean;
};

type Paragraph = {
  type: "paragraph";
  root: boolean;
  /** Entries of a root paragraph's lines, one per physical line. */
  lines: Array<Entry>;
  /** Stripped line text, kept only while a link reference definition could
   *  open the paragraph; it decides whether a setext underline applies. */
  definitionText: Array<string> | undefined;
  count: number;
};

type Leaf =
  | Paragraph
  | { type: "fence"; char: string; length: number }
  | { type: "indented" }
  | { type: "html"; kind: number };

const ROLE_RANK: Record<MarkdownLineRole, number> = {
  blank: 0,
  content: 1,
  frontmatter: 2,
  heading: 3,
};

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
  private readonly queue: Array<Entry> = [];
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
    } else if (this.lineCount === 1 && isDelimiter(nativeLine, false)) {
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
    const entry: Entry = {
      line,
      text,
      role: "blank",
      pending: 0,
      pushed: false,
    };
    this.queue.push(entry);
    for (const physical of stripTerminator(text).split("\r")) {
      if (this.stopped) return;
      this.scanPhysical(entry, expandTabs(physical));
    }
    entry.pushed = true;
    this.flush();
  }

  private mark(
    entry: Entry,
    role: MarkdownLineRole,
    heading?: MarkdownHeading,
  ): void {
    if (ROLE_RANK[role] <= ROLE_RANK[entry.role]) return;
    entry.role = role;
    if (heading) entry.heading = heading;
  }

  private flush(): void {
    while (!this.stopped) {
      const head = this.queue[0];
      if (!head || !head.pushed || head.pending > 0) return;
      this.queue.shift();
      const event: MarkdownLine = {
        line: head.line,
        text: head.text,
        role: head.role,
      };
      if (head.heading) event.heading = head.heading;
      this.stop(this.handlers.onLine?.(event));
    }
  }

  private emitHeadingSpan(heading: MarkdownHeading, endLine: number): void {
    this.stop(
      this.handlers.onSpan?.({
        kind: "heading",
        depth: heading.depth,
        line: heading.line,
        headEnd: heading.headEnd,
        endLine,
        label: heading.label,
      }),
    );
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

  /** Closes the leaf and marks the parent before a new block is added. */
  private addBlock(): void {
    this.closeLeaf();
    const parent = this.containers.at(-1);
    if (parent?.type === "item") parent.hasChild = true;
  }

  private addParagraphLine(entry: Entry, text: string): void {
    const paragraph = this.leaf;
    if (paragraph?.type !== "paragraph") return;
    paragraph.count += 1;
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
    const consumed = paragraph.definitionText
      ? definitionLineCount(paragraph.definitionText)
      : 0;
    if (consumed >= paragraph.count) return false;
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
    if (rest[0] === ">") {
      consumeQuoteMarker(cursor);
      this.addContainer(state, { type: "quote" });
      return "container";
    }
    const leaf = this.openLeafBlock(state, rest);
    if (leaf !== "none") return leaf;
    const item = listItemStart(
      cursor.line,
      cursor.offset,
      cursor.next,
      state.paragraphContainer,
    );
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
    const fence = FENCE_OPEN.exec(rest);
    if (fence) {
      this.addLeaf(state, {
        type: "fence",
        char: rest[0] ?? "`",
        length: fence[0].length,
      });
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
      this.closeUnmatched(state);
      this.addBlock();
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
    this.closeUnmatched(state);
    this.addBlock();
    this.containers.push(container);
  }

  private addLeaf(state: LineState, leaf: Leaf): void {
    this.closeUnmatched(state);
    this.addBlock();
    this.leaf = leaf;
    state.cursor.offset = state.cursor.next;
  }

  private addAtxHeading(state: LineState, depth: number): void {
    this.closeUnmatched(state);
    this.addBlock();
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
      this.addBlock();
      this.leaf = {
        type: "paragraph",
        root: this.containers.length === 0,
        lines: [],
        definitionText: text.startsWith("[") ? [] : undefined,
        count: 0,
      };
      this.addParagraphLine(entry, text);
      return;
    }
    this.mark(entry, cursor.blank ? "blank" : "content");
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
