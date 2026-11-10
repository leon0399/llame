/**
 * The stderr head-plus-tail collector a remote `bash` call asks for: the tail
 * is what keeps the end trailer when the command writes more than the head
 * holds, and the head must stop exactly at its bound so the split stays where
 * the trailer is.
 */
import { setImmediate as tick } from 'node:timers/promises';
import { PassThrough } from 'node:stream';

import { createSshClient, type SshClient } from './ssh-client';
import {
  SSH_DIAGNOSTIC_BYTES,
  type SshProcess,
  type SshSpawn,
} from './ssh-process';

const TAIL_BYTES = 64;

type FakeProcess = SshProcess & {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly stdin: PassThrough;
  error(error: Error): void;
  close(code: number | null, signal?: string | null): void;
};

function fakeClient() {
  const processes: Array<FakeProcess> = [];

  const spawn: SshSpawn = () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const errorHandlers: Array<(error: Error) => void> = [];

    const closeHandlers: Array<
      (code: number | null, signal: string | null) => void
    > = [];

    const process: FakeProcess = {
      stdout,
      stderr,
      stdin,
      kill: vi.fn(),
      onError: (handler) => errorHandlers.push(handler),
      onClose: (handler) => closeHandlers.push(handler),
      error: (error) => errorHandlers.forEach((handler) => handler(error)),
      close: (code, signal = null) =>
        closeHandlers.forEach((handler) => handler(code, signal)),
    };

    processes.push(process);

    return process;
  };

  const client = createSshClient({
    ssh: { knownHostsFile: '/etc/llame/known_hosts' },
    spawn,
    configFile: {
      path: '/run/llame/ssh_config',
      text: 'Host *\n  BatchMode yes\n',
      dispose: vi.fn(),
    },
    resolutionDeadlineMs: 5000,
  });

  return { client, processes };
}

function runWithTail(client: SshClient) {
  return client.run({
    destination: 'box',
    remoteCommand: ['bash', '-s'],
    maxStdoutBytes: 1024,
    deadlineMs: 5000,
    stderrTailBytes: TAIL_BYTES,
  });
}

/**
 * Write a whole head, a dropped middle, and a tail that starts with `tail` and
 * is padded to exactly the tail bound, so those bytes stay at the tail's start.
 */
function writeSplitStream(
  process: FakeProcess,
  head: Buffer,
  tail: Buffer,
): void {
  process.stderr.write(head);
  process.stderr.write('m'.repeat(100));
  process.stderr.write(
    Buffer.concat([
      tail,
      Buffer.from(`z${'b'.repeat(TAIL_BYTES - tail.length - 1)}`),
    ]),
  );
  process.close(1);
}

const HEAD_AT_BOUND = Buffer.from('a'.repeat(SSH_DIAGNOSTIC_BYTES));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('remote bash stderr tail', () => {
  it('stops the head at its bound and keeps the last tail bytes when it drops', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    // Two chunks: the first fills part of the head, so the second one is
    // measured against what is left of the bound and not against the bound.
    process.stderr.write('a'.repeat(100));
    process.stderr.write('b'.repeat(20_000));
    process.close(1);

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    const headBytes = SSH_DIAGNOSTIC_BYTES - 100;
    // The head and the tail are adjacent in the stream, so they join with no
    // separator: an inserted one could split the end trailer.
    expect(outcome.diagnostic).toBe(
      'a'.repeat(100) + 'b'.repeat(headBytes + TAIL_BYTES),
    );
    expect(outcome.stderrOverflow).toBe(true);
    // The head is all ASCII here, so its byte count is its code-unit count.
    expect(outcome.diagnosticGap).toBe(SSH_DIAGNOSTIC_BYTES);
  });

  it('locates a gap that splits a multi-byte character', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stderr.write(`${'a'.repeat(SSH_DIAGNOSTIC_BYTES - 1)}é`);
    process.stderr.write('b'.repeat(100));
    process.close(1);

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.stderrOverflow).toBe(true);
    // The head ends inside the two-byte `é`; the gap sits before the
    // character starts, so it is the byte count of the ASCII prefix.
    expect(outcome.diagnosticGap).toBe(SSH_DIAGNOSTIC_BYTES - 1);
  });

  it('decodes an incomplete head and the tail on separate boundaries', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    const headFiller = 'h'.repeat(SSH_DIAGNOSTIC_BYTES - 4);
    process.stderr.write(`${headFiller}aaa`);
    // The last head byte is the lead of a two-byte character the head cut.
    process.stderr.write(Buffer.from([0xc3]));
    // Bytes between the head and the tail are the dropped gap.
    process.stderr.write('dropped-bytes');
    const tail = `KEY-ABCDEF zzz${'q'.repeat(64 - 14)}`;
    process.stderr.write(tail);
    process.close(0);

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    // Neither part invents a replacement character at the gap.
    expect(outcome.diagnostic).toBe(`${headFiller}aaa${tail}`);
    expect(outcome.diagnostic).not.toContain('\uFFFD');
    expect(outcome.diagnosticGap).toBe(headFiller.length + 3);
  });

  it('keeps a byte order mark at the head start', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');

    // The head starts with the UTF-8 byte order mark: the transport's bytes,
    // not a decoder guess, decide whether it stays.
    const head = Buffer.concat([
      Buffer.from('\uFEFF'),
      Buffer.from('a'.repeat(SSH_DIAGNOSTIC_BYTES - 3)),
    ]);

    writeSplitStream(process, head, Buffer.alloc(0));

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.diagnostic).toBe(
      `\uFEFF${'a'.repeat(SSH_DIAGNOSTIC_BYTES - 3)}z${'b'.repeat(63)}`,
    );
    expect(outcome.diagnosticGap).toBe(SSH_DIAGNOSTIC_BYTES - 2);
  });

  it('skips at most three continuation bytes at the tail start', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    // Four continuation bytes cannot all belong to one cut character, so the
    // fourth decodes on its own instead of disappearing with the skipped run.
    writeSplitStream(
      process,
      HEAD_AT_BOUND,
      Buffer.from([0x80, 0x80, 0x80, 0x80]),
    );

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.diagnostic).toBe(
      `${'a'.repeat(SSH_DIAGNOSTIC_BYTES)}\uFFFDz${'b'.repeat(59)}`,
    );
    expect(outcome.diagnosticGap).toBe(SSH_DIAGNOSTIC_BYTES);
  });

  it('skips every continuation byte inside the three-byte window', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    // 0xbf is the last continuation byte: it still belongs to the window and
    // leaves no replacement character behind.
    writeSplitStream(process, HEAD_AT_BOUND, Buffer.from([0xbf, 0xa9]));

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.diagnostic).toBe(
      `${'a'.repeat(SSH_DIAGNOSTIC_BYTES)}z${'b'.repeat(61)}`,
    );
  });

  it('keeps a tail that starts with a lead byte', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    // A lead byte starts a character rather than continuing one, so the tail
    // keeps its `é` whole.
    writeSplitStream(process, HEAD_AT_BOUND, Buffer.from([0xc3, 0xa9]));

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.diagnostic).toBe(
      `${'a'.repeat(SSH_DIAGNOSTIC_BYTES)}éz${'b'.repeat(61)}`,
    );
    expect(outcome.diagnostic).not.toContain('\uFFFD');
  });

  it('keeps its own copy of the head, not a view of the chunk', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    // A view would pin the whole chunk for the call's lifetime; a later write
    // into the chunk shows whether the head kept a view or a copy.
    const chunk = Buffer.from('a'.repeat(100));
    process.stderr.write(chunk);
    await tick();
    chunk.fill('z');
    process.close(1);

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.diagnostic).toBe('a'.repeat(100));
  });

  it('keeps a trailer split across the head bound whole, with no overflow', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    // The boundary falls inside the trailer: the head holds `:en` and the
    // tail begins with `d:0`.
    const head = 'a'.repeat(SSH_DIAGNOSTIC_BYTES - 3) + ':en';
    process.stderr.write(head);
    process.stderr.write('d:0\n');
    process.close(0);

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.diagnostic).toBe(`${head}d:0\n`);
    expect(outcome.stderrOverflow).toBe(false);
  });

  it('keeps a short stderr exactly, with no separator and no overflow', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stderr.write('warn: something\n');
    process.close(0);

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.diagnostic).toBe('warn: something\n');
    expect(outcome.stderrOverflow).toBe(false);
  });

  it('keeps the end trailer a command wrote past the head', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stderr.write('login noise\n'.repeat(1000));
    process.stderr.write('command err\nnonce:end:7\n');
    process.close(0);

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.diagnostic.endsWith('nonce:end:7\n')).toBe(true);
    // 12,000 noise bytes plus the command's own line: the tail dropped only
    // what cannot fit, so the stream is still an overflow.
    expect(outcome.stderrOverflow).toBe(true);
  });

  it('ignores an error event on stderr instead of losing the outcome', async () => {
    const { client, processes } = fakeClient();
    const pending = runWithTail(client);
    const process = processes[0];

    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stderr.emit('error', new Error('read EPIPE'));
    process.stdout.write('command out\n');
    process.close(0);

    const outcome = await pending;

    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.stdout.toString()).toBe('command out\n');
    expect(outcome.diagnostic).toBe('');
  });
});
