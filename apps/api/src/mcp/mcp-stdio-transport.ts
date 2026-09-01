import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';

import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  deserializeMessage,
  serializeMessage,
} from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { redactProtectedString } from './protected-values';
import { isString } from '../unknown-record';

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
  readonly args?: ReadonlyArray<string>;
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
  protectedValues: ReadonlyArray<string>,
): ReadonlyArray<string> {
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
  private readonly protectedValues: ReadonlyArray<string>;

  constructor(
    protectedValues: ReadonlyArray<string>,
    private readonly emit: (text: string) => void,
  ) {
    this.protectedValues = withLineFragments(protectedValues);
  }

  append(chunk: Buffer | string): void {
    if (this.retained >= MAX_DIAGNOSTIC_CHARS) return;

    const text = isString(chunk) ? chunk : chunk.toString('utf8');
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

/**
 * Fixed v1 bound on a single unterminated stdio line, in bytes. Mirrors the
 * 1 MiB pre-parse cap `mcp-bounded-fetch.ts` enforces on a remote response
 * body or SSE event before parsing — the same limit, applied to the one
 * framing boundary stdio has (a newline) instead of a byte-length or
 * `Content-Length` header.
 */
export const MAX_STDIO_MESSAGE_BYTES = 1024 * 1024;

export class McpStdioMessageLimitError extends Error {
  constructor(readonly limit: number) {
    super(`MCP stdio message exceeded the ${limit}-byte transport limit.`);
    this.name = 'McpStdioMessageLimitError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/**
 * Buffers a stdio child's stdout into discrete JSON-RPC lines, bounded.
 *
 * The pinned MCP SDK's own `ReadBuffer` (`shared/stdio.js`) never bounds
 * `Buffer.concat`: a child that writes without ever emitting a newline grows
 * this process's heap without limit, unlike the remote transport's response
 * body, which `mcp-bounded-fetch.ts` caps before parsing. This applies the
 * same cap to the one accumulation point stdio has. The check runs before the
 * concat, not after, so an oversized write is refused at ~cap + one chunk of
 * peak memory rather than after allocating the oversized buffer once.
 */
export class BoundedReadBuffer {
  private buffer: Buffer | undefined;
  private limitExceeded = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    const nextLength = (this.buffer?.length ?? 0) + chunk.length;
    if (this.limitExceeded || nextLength > this.maxBytes) {
      this.limitExceeded = true;
      this.buffer = undefined;
      throw new McpStdioMessageLimitError(this.maxBytes);
    }
    this.buffer = this.buffer ? Buffer.concat([this.buffer, chunk]) : chunk;
  }

  readMessage(): JSONRPCMessage | null {
    if (this.buffer === undefined) return null;
    const index = this.buffer.indexOf('\n');
    if (index === -1) return null;
    const line = this.buffer.toString('utf8', 0, index).replace(/\r$/u, '');
    this.buffer = this.buffer.subarray(index + 1);
    return deserializeMessage(line);
  }

  clear(): void {
    this.buffer = undefined;
  }
}

/**
 * Client transport for stdio, replacing the pinned SDK's own
 * `StdioClientTransport` for exactly one reason: that class's stdout path has
 * no size bound (see `BoundedReadBuffer`), and the SDK exposes no way to
 * intercept stdout before its internal buffer sees it — spawn is fully
 * internal to `start()`, there is no `stdout` accessor, and the process
 * handle is a TypeScript-private field this codebase's own lint rules forbid
 * reaching into via `as unknown as T`. Wrapping the SDK's class therefore
 * cannot close the gap; only owning the spawn can.
 *
 * Everything else — spawn options, the base-environment allowlist, the
 * close() escalation (stdin.end -> wait -> SIGTERM -> wait -> SIGKILL), and
 * the stderr-as-PassThrough contract — is transcribed from the pinned SDK
 * verbatim, so this transport's observable behavior does not diverge from it
 * outside the one bound it adds.
 *
 * Structurally satisfies both the pinned MCP SDK's own `Transport` interface
 * and `@ai-sdk/mcp`'s `MCPTransport` — deliberately not declared against
 * either: the two packages' `JSONRPCMessage` types differ narrowly (an
 * error's `id` is optional in one, required in the other), and this class is
 * typed against the raw SDK's own wire type throughout, exactly as
 * `StdioClientTransport` itself is. `createMCPClient` accepts it the same way
 * it always accepted `StdioClientTransport`: structurally, not nominally.
 */
export class BoundedStdioTransport {
  private process: ChildProcess | undefined;
  private readonly readBuffer = new BoundedReadBuffer(MAX_STDIO_MESSAGE_BYTES);
  private readonly stderrStream = new PassThrough();

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  protocolVersion?: string;

  constructor(private readonly config: McpStdioTransportConfig) {}

  /**
   * Returned immediately, before `start()` — matches the pinned SDK's own
   * contract, so a caller can attach a diagnostic listener before the child
   * launches and lose no early output.
   */
  get stderr(): Readable | null {
    return this.stderrStream;
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('BoundedStdioTransport already started!');
    }
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.command, [...(this.config.args ?? [])], {
        // Merged over the base allowlist, matching the pinned SDK's own
        // getDefaultEnvironment() — nothing else of llame's ambient
        // environment is passed through.
        env: { ...getDefaultEnvironment(), ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: process.platform === 'win32',
        ...(this.config.cwd !== undefined && { cwd: this.config.cwd }),
      });
      this.process = child;

      child.on('error', (error) => {
        reject(error);
        this.onerror?.(error);
      });
      child.on('spawn', () => resolve());
      child.on('close', () => {
        this.process = undefined;
        this.onclose?.();
      });
      child.stdin?.on('error', (error) => this.onerror?.(error));
      child.stdout?.on('data', (chunk: Buffer) => this.handleChunk(chunk));
      child.stdout?.on('error', (error) => this.onerror?.(error));
      child.stderr?.pipe(this.stderrStream);
    });
  }

  private handleChunk(chunk: Buffer): void {
    try {
      this.readBuffer.append(chunk);
    } catch (error) {
      // A cap overrun is a transport fault, not a recoverable per-message
      // error: continuing to read only grows the buffer further. Kill the
      // child; its 'close' event fires onclose exactly as any other exit,
      // which is what already drives catalog withdrawal and bounded retry.
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      this.process?.kill('SIGKILL');
      this.readBuffer.clear();
      return;
    }
    this.drainMessages();
  }

  private drainMessages(): void {
    while (true) {
      let message: JSONRPCMessage | null;
      try {
        message = this.readBuffer.readMessage();
      } catch (error) {
        // Matches the pinned SDK: one malformed line is reported and
        // skipped, not treated as fatal to the whole stream.
        this.onerror?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        continue;
      }
      if (message === null) break;
      this.onmessage?.(message);
    }
  }

  async close(): Promise<void> {
    const processToClose = this.process;
    if (processToClose === undefined) {
      this.readBuffer.clear();
      return;
    }
    this.process = undefined;
    const closed = new Promise<void>((resolve) => {
      processToClose.once('close', () => resolve());
    });
    try {
      processToClose.stdin?.end();
    } catch {
      // ignore
    }
    await Promise.race([closed, delay(2000)]);
    if (processToClose.exitCode === null) {
      try {
        processToClose.kill('SIGTERM');
      } catch {
        // ignore
      }
      await Promise.race([closed, delay(2000)]);
    }
    if (processToClose.exitCode === null) {
      try {
        processToClose.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    this.readBuffer.clear();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Not connected'));
        return;
      }
      const json = serializeMessage(message);
      if (this.process.stdin.write(json)) {
        resolve();
      } else {
        this.process.stdin.once('drain', resolve);
      }
    });
  }
}

export function createStdioTransport(
  config: McpStdioTransportConfig,
): BoundedStdioTransport {
  return new BoundedStdioTransport(config);
}
