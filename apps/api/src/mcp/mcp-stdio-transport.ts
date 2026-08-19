import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { redactProtectedString } from './protected-values';

/**
 * Upper bound on diagnostic text retained per server, in UTF-16 code units —
 * what a JS string actually costs, which is the quantity worth bounding here.
 * A stdio child can write to its diagnostic stream without limit; this keeps a
 * head rather than the whole stream, so a chatty or looping server cannot
 * exhaust memory.
 */
export const MAX_DIAGNOSTIC_CHARS = 64 * 1024;

export type McpStdioTransportConfig = {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
};

/**
 * Shortest line of a multiline protected value that is still worth matching on
 * its own. A protected value is redacted by exact substring match, so a short
 * fragment ("a", "-", "1") would blank out unrelated diagnostic text and make
 * the log useless. Base64 key lines and JSON credential lines sit far above
 * this, so the guard costs nothing on the shapes that motivate the split.
 */
const MIN_PROTECTED_FRAGMENT_CHARS = 8;

/**
 * Adds each substantial line of a multiline protected value as a value in its
 * own right.
 *
 * A protected value may span lines: `{path:…}` only trims the file's outer
 * whitespace, so a PEM key or a JSON service-account file keeps its internal
 * newlines, and an `{env:…}` value can too. Diagnostics are released one line
 * at a time, so no single released line ever contains such a value whole, and
 * an exact-substring match would never fire — every line of the credential
 * would reach the operator log verbatim. Matching the fragments closes that.
 *
 * Fragments below the floor are deliberately left out; what remains of a
 * secret in a sub-eight-character line is not worth blinding the log for.
 */
function withLineFragments(
  protectedValues: readonly string[],
): readonly string[] {
  const expanded = new Set(protectedValues);
  for (const value of protectedValues) {
    if (!value.includes('\n')) continue;
    for (const fragment of value.split('\n')) {
      const trimmed = fragment.trim();
      if (trimmed.length >= MIN_PROTECTED_FRAGMENT_CHARS) expanded.add(trimmed);
    }
  }
  return [...expanded];
}

/**
 * Buffers a child's diagnostic stream, redacting protected values.
 *
 * Redaction happens over accumulated lines rather than per chunk, because a
 * secret can straddle a chunk boundary — the stream is split by pipe buffering,
 * not by token. Emission is therefore line-oriented: a line is released only
 * once its terminator arrives, so a single-line secret inside it is whole.
 *
 * A secret that itself spans lines is never whole in one released line, which
 * is why the protected set is expanded with its line fragments first.
 */
export class DiagnosticBuffer {
  private pending = '';
  private retained = 0;
  private readonly protectedValues: readonly string[];

  constructor(
    protectedValues: readonly string[],
    private readonly emit: (text: string) => void,
  ) {
    this.protectedValues = withLineFragments(protectedValues);
  }

  append(chunk: Buffer | string): void {
    if (this.retained >= MAX_DIAGNOSTIC_CHARS) return;

    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const room = MAX_DIAGNOSTIC_CHARS - this.retained;
    // When the cap forces truncation, cut at a line boundary rather than mid
    // text. An arbitrary cut can split a protected value in half, and a half
    // is not a substring match — the surviving fragment of a credential would
    // then be emitted unredacted by the final flush.
    let accepted = text;
    if (text.length > room) {
      const head = text.slice(0, room);
      const lastNewline = head.lastIndexOf('\n');
      // No safe cut point at all (one chunk with no embedded newline within
      // the remaining room): drop it rather than retain a fragment that might
      // be half of a secret. Crucially, this chunk contributed nothing kept,
      // so it must not count against the budget — doing so would mark the
      // buffer permanently full and silently discard every later chunk too,
      // even a well-formed one that would otherwise fit.
      if (lastNewline === -1) return;
      accepted = head.slice(0, lastNewline + 1);
    }
    this.retained += accepted.length;
    if (accepted.length === 0) return;

    // Scan only the newly appended region: a terminator cannot appear in text
    // already searched, so restarting from index 0 each time would make N
    // newline-free chunks cost O(N^2) on the shared event loop. The consumed
    // prefix is sliced once at the end rather than once per line.
    const searchFrom = this.pending.length;
    this.pending += accepted;

    let start = 0;
    let newline = this.pending.indexOf('\n', searchFrom);
    while (newline !== -1) {
      this.release(this.pending.slice(start, newline));
      start = newline + 1;
      newline = this.pending.indexOf('\n', start);
    }
    if (start > 0) this.pending = this.pending.slice(start);
  }

  /** Releases whatever is buffered without a terminator, e.g. at close. */
  flush(): void {
    if (this.pending.length === 0) return;
    const line = this.pending;
    this.pending = '';
    this.release(line);
  }

  private release(line: string): void {
    if (line.trim().length === 0) return;
    this.emit(redactProtectedString(line, this.protectedValues));
  }
}

export function createStdioTransport(
  config: McpStdioTransportConfig,
): StdioClientTransport {
  return new StdioClientTransport({
    command: config.command,
    args: [...(config.args ?? [])],
    // The library merges this over its own base allowlist — a small fixed set
    // (HOME, LOGNAME, PATH, SHELL, TERM, USER on POSIX) copied from llame's
    // environment so the child can find its executable, and skipped when the
    // parent does not define it. Nothing else of llame's is passed through, so
    // a credential llame holds stays out unless the entry declares it.
    env: { ...config.env },
    // Captured and sanitized by the caller. Never 'inherit': a server that
    // echoes a credential on a startup error would write it to llame's own
    // diagnostic stream, where the protected-value boundary cannot reach it.
    stderr: 'pipe',
    ...(config.cwd !== undefined && { cwd: config.cwd }),
  });
}
