import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { redactProtectedString } from './protected-values';

/**
 * Upper bound on diagnostic output retained per server. A stdio child can write
 * to its diagnostic stream without limit; this keeps a tail rather than the
 * whole stream, so a chatty or looping server cannot exhaust memory.
 */
export const MAX_DIAGNOSTIC_BYTES = 64 * 1024;

export type McpStdioTransportConfig = {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
};

/**
 * Buffers a child's diagnostic stream, redacting protected values.
 *
 * Redaction happens over the accumulated tail rather than per chunk, because a
 * secret can straddle a chunk boundary — the stream is split by pipe buffering,
 * not by token. Emission is therefore line-oriented: a line is released only
 * once its terminator arrives, by which point any secret inside it is whole.
 */
export class DiagnosticBuffer {
  private pending = '';
  private retained = 0;

  constructor(
    private readonly protectedValues: () => readonly string[],
    private readonly emit: (text: string) => void,
  ) {}

  append(chunk: Buffer | string): void {
    if (this.retained >= MAX_DIAGNOSTIC_BYTES) return;

    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const room = MAX_DIAGNOSTIC_BYTES - this.retained;
    const accepted = text.length > room ? text.slice(0, room) : text;
    this.retained += accepted.length;
    this.pending += accepted;

    let newline: number;
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      this.release(line);
    }
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
    this.emit(redactProtectedString(line, this.protectedValues()));
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
