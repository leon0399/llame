import { NativeFileError, type ReadTarget } from "./path";
import { createMarkdownScanner, type MarkdownLine } from "./markdown-structure";
import {
  createMarkdownAncestorTracker,
  type MarkdownHeadingUnit,
} from "./markdown-ancestors";
import { isDelimiter } from "./markdown-syntax";
import { measureNativeModelOutput } from "./serialization";
import {
  MAX_READ_LINES,
  renderSourceLine,
  resultBudget,
  type SingleReadSuccess,
} from "./source-lines";

const MAX_OUTLINE_LINE_UNITS = 120;

type NativeEntry = { line: number; text: string };

type FrontmatterState = {
  keyCount: number;
  omittedInScope: boolean;
  omittedLine?: number;
};

function stripAndCutLine(text: string): string {
  const terminator = /\r?\n$/u.exec(text)?.[0] ?? "";
  const body = text.slice(0, text.length - terminator.length);
  if (body.length <= MAX_OUTLINE_LINE_UNITS) return text;
  let end = MAX_OUTLINE_LINE_UNITS;
  const code = body.charCodeAt(end - 1);
  if (code >= 0xd8_00 && code <= 0xdb_ff) end -= 1;
  return body.slice(0, end) + "…" + terminator;
}

function isFrontmatterKey(text: string): boolean {
  const first = text[0];
  return (
    first !== undefined && !/\s/u.test(first) && first !== "#" && first !== "-"
  );
}

class MarkdownOutlineReader {
  private readonly result: SingleReadSuccess;
  private readonly startLine: number;
  private readonly endLine: number | undefined;
  private readonly scoped: boolean;
  private readonly tracker = createMarkdownAncestorTracker();
  private readonly excerpts = new Map<
    MarkdownHeadingUnit["heading"],
    NativeEntry
  >();
  private frontmatter: FrontmatterState | undefined;
  private sourceLineCount = 0;
  private emittedLines = 0;
  private rootExcerptSeen = false;
  private scopeStarted: boolean;
  private stopped = false;

  constructor(private readonly target: ReadTarget) {
    this.startLine = target.offset + 1;
    this.endLine =
      target.limit === undefined ? undefined : target.offset + target.limit;
    this.scoped = target.offset > 0 || target.limit !== undefined;
    this.scopeStarted = !this.scoped;
    this.result = {
      status: "success",
      kind: "file",
      path: target.path,
      representation: "outline",
      content: "",
      requestedRange:
        this.endLine === undefined
          ? null
          : { startLine: this.startLine, endLine: this.endLine },
      shownRange: null,
      truncated: false,
    };
    if (target.realPath !== undefined) this.result.realPath = target.realPath;
  }

  async read(
    lines: AsyncIterable<string> | Iterable<string>,
  ): Promise<SingleReadSuccess> {
    const scanner = createMarkdownScanner({
      onLine: (line) => {
        this.tracker.accept(line);
        return this.handleLine(line);
      },
    });
    for await (const line of lines) {
      if (!scanner.push(line)) break;
    }
    if (!this.stopped) scanner.end();
    return this.finish();
  }

  private requestedRangeForAppend(): SingleReadSuccess["requestedRange"] {
    if (
      !this.scoped &&
      this.endLine === undefined &&
      this.sourceLineCount > 0
    ) {
      return { startLine: 1, endLine: Number.MAX_SAFE_INTEGER };
    }
    return this.result.requestedRange;
  }

  private handleLine(line: MarkdownLine): boolean {
    this.sourceLineCount = line.line;
    if (line.role === "frontmatter") return this.handleFrontmatter(line);
    if (this.endLine !== undefined && line.line > this.endLine) {
      this.stopped = true;
      return false;
    }
    if (
      !this.startScope(
        line.line,
        line.role === "heading" || line.role === "content"
          ? { line: line.line, text: line.text }
          : undefined,
      )
    )
      return false;
    if (line.role === "heading") return this.handleHeading(line);
    if (line.role === "content") return this.handleContent(line);
    return true;
  }

  private handleFrontmatter(line: MarkdownLine): boolean {
    const entry = { line: line.line, text: line.text };
    if (line.line === 1) {
      this.frontmatter = { keyCount: 0, omittedInScope: false };
      return this.emitSource(entry);
    }
    const state = this.frontmatter;
    if (state === undefined) return true;
    if (isDelimiter(line.text, true)) {
      this.frontmatter = undefined;
      if (state.keyCount > 32 && state.omittedInScope) {
        if (!this.startScope(state.omittedLine ?? line.line)) return false;
        const marker = `[… ${state.keyCount - 32} more frontmatter lines]\n`;
        if (!this.append(marker, line.line, false)) return false;
      }
      return this.emitSource(entry);
    }
    if (!isFrontmatterKey(line.text)) return true;
    state.keyCount += 1;
    if (state.keyCount <= 32) return this.emitSource(entry);
    if (!this.isInScope(line.line)) return true;
    state.omittedInScope = true;
    state.omittedLine ??= line.line;
    return this.startScope(line.line);
  }

  private startScope(line: number, firstEntry?: NativeEntry): boolean {
    if (!this.scoped || this.scopeStarted || line < this.startLine) return true;
    this.scopeStarted = true;
    const ancestors = this.ancestorEntries();
    if (!this.fitsAncestorChain(ancestors, firstEntry)) return true;
    for (const entry of ancestors) {
      if (!this.appendSource(entry)) return false;
    }
    return true;
  }

  private ancestorEntries(): Array<NativeEntry> {
    const entries: Array<NativeEntry> = [];
    for (const unit of this.tracker.current()) {
      for (const line of unit.lines) {
        if (line.line >= this.startLine) break;
        entries.push({ line: line.line, text: line.text });
      }
      const excerpt = this.excerpts.get(unit.heading);
      if (excerpt !== undefined && excerpt.line < this.startLine)
        entries.push(excerpt);
    }
    return entries;
  }

  private fitsAncestorChain(
    entries: Array<NativeEntry>,
    firstEntry?: NativeEntry,
  ): boolean {
    if (entries.length + 1 + this.emittedLines > MAX_READ_LINES) return false;
    const first = entries[0] ?? firstEntry;
    const last = firstEntry ?? entries.at(-1);
    if (first === undefined || last === undefined) return true;
    let content = this.result.content;
    for (const entry of entries) {
      content += renderSourceLine(stripAndCutLine(entry.text), entry.line - 1);
    }
    if (firstEntry !== undefined) {
      content += renderSourceLine(
        stripAndCutLine(firstEntry.text),
        firstEntry.line - 1,
      );
    }
    return (
      measureNativeModelOutput({
        ...this.result,
        content,
        requestedRange: this.requestedRangeForAppend(),
        shownRange: { startLine: first.line, endLine: last.line },
        nextOffset: last.line - 1,
      }) <= resultBudget(this.target)
    );
  }

  private handleHeading(line: MarkdownLine): boolean {
    const heading = line.heading;
    const current = this.tracker.current().at(-1);
    if (heading === undefined || current?.heading !== heading) return true;
    return this.emitSource({ line: line.line, text: line.text });
  }

  private handleContent(line: MarkdownLine): boolean {
    const entry = { line: line.line, text: line.text };
    const current = this.tracker.current().at(-1);
    if (current === undefined) {
      if (this.rootExcerptSeen) return true;
      this.rootExcerptSeen = true;
      return this.emitSource(entry);
    }
    if (this.excerpts.has(current.heading)) return true;
    this.excerpts.set(current.heading, entry);
    if (!this.isInScope(entry.line)) return true;
    if (!this.startScope(entry.line, entry)) return false;
    return this.appendSource(entry);
  }

  private isInScope(line: number): boolean {
    return (
      !this.scoped ||
      (line >= this.startLine &&
        (this.endLine === undefined || line <= this.endLine))
    );
  }

  private emitSource(entry: NativeEntry): boolean {
    if (!this.isInScope(entry.line)) {
      if (this.endLine !== undefined && entry.line > this.endLine) {
        this.stopped = true;
        return false;
      }
      return true;
    }
    if (!this.startScope(entry.line, entry)) return false;
    return this.appendSource(entry);
  }

  private appendSource(entry: NativeEntry): boolean {
    return this.append(
      renderSourceLine(stripAndCutLine(entry.text), entry.line - 1),
      entry.line,
      true,
    );
  }

  private append(
    text: string,
    coordinate: number,
    sourceLine: boolean,
  ): boolean {
    if (this.emittedLines >= MAX_READ_LINES) return this.truncate(coordinate);
    const shownRange = sourceLine
      ? {
          startLine: this.result.shownRange?.startLine ?? coordinate,
          endLine: coordinate,
        }
      : this.result.shownRange;
    const candidate: SingleReadSuccess = {
      ...this.result,
      content: this.result.content + text,
      requestedRange: this.requestedRangeForAppend(),
      shownRange,
    };
    if (
      measureNativeModelOutput({ ...candidate, nextOffset: coordinate }) >
      resultBudget(this.target)
    ) {
      return this.truncate(coordinate);
    }
    this.result.content = candidate.content;
    this.result.requestedRange = candidate.requestedRange;
    this.result.shownRange = candidate.shownRange;
    this.emittedLines += 1;
    return true;
  }

  private truncate(coordinate: number): false {
    this.result.truncated = true;
    this.result.nextOffset = coordinate - 1;
    this.stopped = true;
    return false;
  }

  private finish(): SingleReadSuccess {
    if (
      this.scoped &&
      this.sourceLineCount < this.startLine &&
      (this.sourceLineCount > 0 || this.startLine > 1) &&
      !this.result.truncated
    ) {
      throw new NativeFileError("invalid_selector");
    }
    if (this.sourceLineCount === 0) {
      this.result.requestedRange = null;
    } else if (this.endLine !== undefined) {
      this.result.requestedRange = {
        startLine: this.startLine,
        endLine: this.endLine,
      };
    } else if (!this.scoped) {
      this.result.requestedRange = {
        startLine: 1,
        endLine: this.sourceLineCount,
      };
    } else if (this.result.requestedRange === null) {
      this.result.requestedRange = {
        startLine: this.startLine,
        endLine: this.sourceLineCount,
      };
    }
    return this.result;
  }
}

export async function outlineMarkdown(
  lines: AsyncIterable<string> | Iterable<string>,
  target: ReadTarget,
): Promise<SingleReadSuccess> {
  return new MarkdownOutlineReader(target).read(lines);
}
