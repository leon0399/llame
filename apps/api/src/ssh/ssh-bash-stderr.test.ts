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
