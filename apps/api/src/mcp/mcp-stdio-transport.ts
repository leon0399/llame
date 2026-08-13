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
 * Buffers a child's diagnostic stream, redacting protected values.
 *
 * Redaction happens over accumulated lines rather than per chunk, because a
 * secret can straddle a chunk boundary — the stream is split by pipe buffering,
 * not by token. Emission is therefore line-oriented: a line is released only
 * once its terminator arrives, by which point any secret inside it is whole.
 */
export class DiagnosticBuffer {
  private pending = '';
  private retained = 0;

  constructor(
    private readonly protectedValues: readonly string[],
    private readonly emit: (text: string) => void,
  ) {}

  append(chunk: Buffer | string): void {
    if (this.retained >= MAX_DIAGNOSTIC_CHARS) return;

    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const room = MAX_DIAGNOSTIC_CHARS - this.retained;
    const accepted = text.length > room ? text.slice(0, room) : text;
    this.retained += accepted.length;

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
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
  });
}
