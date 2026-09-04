import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';

import { serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { PROTECTED_VALUE_REDACTION_MARKER } from './protected-values';
import {
  BoundedReadBuffer,
  BoundedStdioTransport,
  createStdioTransport,
  DiagnosticBuffer,
  MAX_DIAGNOSTIC_CHARS,
  MAX_STDIO_MESSAGE_BYTES,
  McpStdioMessageLimitError,
} from './mcp-stdio-transport';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const spawned = vi.mocked(spawn);

/** Exactly the ChildProcess surface BoundedStdioTransport reads (see its start/close/send). */
type FakeChildState = {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(options?: { pid?: number }) {
  const state: FakeChildState = {
    pid: options?.pid ?? 4242,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    kill: vi.fn(),
  };
  const child = Object.assign(new EventEmitter(), state);
  child.kill.mockImplementation(() => {
    child.exitCode = 1;
    child.emit('close');
    return true;
  });
  return child;
}

/**
 * `ChildProcess` carries private state no structural double can satisfy, so the
 * spawn spy has to hand this fake back through the `never` bottom type.
 */
function asChildProcess(child: ReturnType<typeof fakeChild>): never {
  // SAFETY: BoundedStdioTransport touches only pid, exitCode, kill, the three
  // stdio streams, and the 'error'/'spawn'/'close' events — all implemented above.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return child as never;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('DiagnosticBuffer', () => {
  it('redacts whole secrets and substantial multiline fragments, not short lines', () => {
    const emitted: Array<string> = [];
    const buffer = new DiagnosticBuffer(
      [
        'supersecret-token',
        '-----BEGIN KEY-----\nABCDEFGH\nshort\n-----END KEY-----',
      ],
      (text) => emitted.push(text),
    );

    buffer.append('before supersecret-token after\n');
    buffer.append('ABCDEFGH leaked\n');
    buffer.append('short leaked\n');

    expect(emitted[0]).toContain(PROTECTED_VALUE_REDACTION_MARKER);
    expect(emitted[0]).not.toContain('supersecret-token');
    expect(emitted[1]).toContain(PROTECTED_VALUE_REDACTION_MARKER);
    expect(emitted[1]).not.toContain('ABCDEFGH');
    expect(emitted[2]).toContain('short leaked');
  });

  it('holds a line until its terminator and flushes the remainder on close', () => {
    const emitted: Array<string> = [];
    const buffer = new DiagnosticBuffer(['unused-secret'], (text) =>
      emitted.push(text),
    );

    buffer.append('partial');
    expect(emitted).toEqual([]);
    buffer.append(' line\nnext');
    expect(emitted).toEqual(['partial line']);
    buffer.flush();
    expect(emitted).toEqual(['partial line', 'next']);
    buffer.flush();
    expect(emitted).toEqual(['partial line', 'next']);
  });

  it('accepts Buffer chunks and ignores blank released lines', () => {
    const emitted: Array<string> = [];
    const buffer = new DiagnosticBuffer([], (text) => emitted.push(text));

    buffer.append(Buffer.from('   \nvisible\n', 'utf8'));
    expect(emitted).toEqual(['visible']);
  });

  it('cuts an oversized chunk at the last newline inside the remaining room', () => {
    const emitted: Array<string> = [];
    const buffer = new DiagnosticBuffer([], (text) => emitted.push(text));
    buffer.append(`${'a'.repeat(MAX_DIAGNOSTIC_CHARS - 20)}\n`);
    buffer.append(`ok\n${'y'.repeat(50)}\n`);

    expect(emitted).toEqual(['a'.repeat(MAX_DIAGNOSTIC_CHARS - 20), 'ok']);
  });

  it('drops a newline-free overflow rather than keeping a secret fragment', () => {
    const emitted: Array<string> = [];
    const buffer = new DiagnosticBuffer([], (text) => emitted.push(text));
    buffer.append('x'.repeat(MAX_DIAGNOSTIC_CHARS + 10));
    buffer.append('kept\n');

    expect(emitted).toEqual(['kept']);
  });
});

describe('BoundedReadBuffer', () => {
  const ping: JSONRPCMessage = {
    jsonrpc: '2.0',
    id: 1,
    method: 'ping',
    params: {},
  };

  it('reads a CRLF-terminated JSON-RPC line and then returns null', () => {
    const buffer = new BoundedReadBuffer(1024);
    buffer.append(Buffer.from(`${JSON.stringify(ping)}\r\n`, 'utf8'));
    expect(buffer.readMessage()).toEqual(ping);
    expect(buffer.readMessage()).toBeNull();
  });

  it('assembles a message across chunks and rejects one over the byte cap', () => {
    const buffer = new BoundedReadBuffer(32);
    buffer.append(Buffer.from('{"jsonrpc":"2.0",', 'utf8'));
    expect(buffer.readMessage()).toBeNull();
    expect(() =>
      buffer.append(Buffer.from(`${'x'.repeat(40)}\n`, 'utf8')),
    ).toThrow(McpStdioMessageLimitError);
    expect(() => buffer.append(Buffer.from('x\n'))).toThrow(
      McpStdioMessageLimitError,
    );
  });

  it('allows a message of exactly the cap and throws using the named error', () => {
    const json = JSON.stringify(ping);
    const padded = `${json}\n`;
    const tooSmall = new BoundedReadBuffer(json.length - 1);
    expect(() => tooSmall.append(Buffer.from(padded))).toThrow(
      McpStdioMessageLimitError,
    );

    const exact = new BoundedReadBuffer(json.length);
    exact.append(Buffer.from(padded));
    expect(exact.readMessage()).toEqual(ping);
  });

  it('clears a partial buffer so the next read is empty', () => {
    const buffer = new BoundedReadBuffer(1024);
    buffer.append(Buffer.from('{"jsonrpc":', 'utf8'));
    buffer.clear();
    expect(buffer.readMessage()).toBeNull();
  });

  it('exposes a stable limit error name and message', () => {
    const error = new McpStdioMessageLimitError(MAX_STDIO_MESSAGE_BYTES);
    expect(error.name).toBe('McpStdioMessageLimitError');
    expect(error.limit).toBe(MAX_STDIO_MESSAGE_BYTES);
    expect(error.message).toBe(
      `MCP stdio message exceeded the ${MAX_STDIO_MESSAGE_BYTES}-byte transport limit.`,
    );
  });
});

describe('BoundedStdioTransport', () => {
  it('starts once, merges env, and refuses a second start', async () => {
    const child = fakeChild();
    spawned.mockReturnValue(asChildProcess(child));
    const transport = createStdioTransport({
      command: '/bin/mcp',
      args: ['--stdio'],
      env: { TOKEN: 't' },
      cwd: '/tmp/mcp',
    });

    const started = transport.start();
    child.emit('spawn');
    await started;

    expect(transport.pid).toBe(4242);
    expect(transport.stderr).toBeInstanceOf(PassThrough);
    expect(spawned).toHaveBeenCalledWith(
      '/bin/mcp',
      ['--stdio'],
      expect.objectContaining({
        cwd: '/tmp/mcp',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: process.platform === 'win32',
      }),
    );
    expect(spawned.mock.calls[0]?.[2]?.env?.TOKEN).toBe('t');

    await expect(transport.start()).rejects.toThrow(
      'BoundedStdioTransport already started!',
    );
  });

  it('delivers parsed stdout messages and reports a cap overrun as a transport fault', async () => {
    const child = fakeChild();
    spawned.mockReturnValue(asChildProcess(child));
    const transport = new BoundedStdioTransport({ command: '/bin/mcp' });
    const messages: Array<JSONRPCMessage> = [];
    const errors: Array<Error> = [];
    transport.onmessage = (message) => messages.push(message);
    transport.onerror = (error) => errors.push(error);

    const started = transport.start();
    child.emit('spawn');
    await started;

    const ping: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 7,
      method: 'ping',
      params: {},
    };
    child.stdout.emit('data', Buffer.from(`${JSON.stringify(ping)}\n`));
    expect(messages).toEqual([ping]);

    child.stdout.emit(
      'data',
      Buffer.from(`${'x'.repeat(MAX_STDIO_MESSAGE_BYTES + 8)}\n`),
    );
    expect(errors[0]).toBeInstanceOf(McpStdioMessageLimitError);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('writes serialized JSON-RPC to stdin and rejects when disconnected', async () => {
    const child = fakeChild();
    spawned.mockReturnValue(asChildProcess(child));
    const transport = new BoundedStdioTransport({ command: '/bin/mcp' });
    const ping: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 3,
      method: 'ping',
      params: {},
    };

    await expect(transport.send(ping)).rejects.toThrow('Not connected');

    const started = transport.start();
    child.emit('spawn');
    await started;

    // BoundedStdioTransport.send calls stdin.write(json) with one string and no
    // callback, so this replacement matches that single call shape.
    const written: Array<string> = [];
    child.stdin.write = (chunk: string) => {
      written.push(chunk);
      return true;
    };

    await transport.send(ping);
    expect(written.join('')).toBe(serializeMessage(ping));
  });

  it('waits for drain when stdin.write returns false', async () => {
    const child = fakeChild();
    spawned.mockReturnValue(asChildProcess(child));
    const transport = new BoundedStdioTransport({ command: '/bin/mcp' });
    const started = transport.start();
    child.emit('spawn');
    await started;

    child.stdin.write = () => false;
    const ping: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 4,
      method: 'ping',
      params: {},
    };
    const sent = transport.send(ping);
    child.stdin.emit('drain');
    await sent;
  });

  it('close on an unstarted transport is a no-op, and close ends a live child', async () => {
    const transport = new BoundedStdioTransport({ command: '/bin/mcp' });
    await transport.close();

    const child = fakeChild();
    spawned.mockReturnValue(asChildProcess(child));
    const started = transport.start();
    child.emit('spawn');
    await started;

    const ended = vi.spyOn(child.stdin, 'end');
    const closing = transport.close();
    child.exitCode = 0;
    child.emit('close');
    await closing;
    expect(ended).toHaveBeenCalled();
  });
});
