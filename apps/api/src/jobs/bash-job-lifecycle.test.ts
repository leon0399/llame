import {
  type BashResult,
  type ManagedBashHandle,
  type ManagedOutput,
  type ManagedStopCause,
  type ManagedStopResult,
} from '@workspace/bash-executor';
import { type MockInstance } from 'vitest';

import { ChatsRepository } from '../chats/chats-repository';
import { type ChatJob } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { type BashJobFacts } from './bash-job-registry';
import { BashJobLifecycle } from './bash-job-lifecycle';
import { ChatJobsRepository } from './chat-jobs.repository';
import * as jobNotices from './job-notices';

const OWNER = 'owner';

const facts: BashJobFacts = {
  ownerUserId: OWNER,
  chatId: 'chat',
  runId: 'run',
  toolCallId: 'call',
  startedAt: new Date('2026-11-11T10:00:00.000Z'),
  settings: { modelId: 'm', permissionMode: 'default' },
  maxBytes: 1_000_000,
  configuredCredentials: [],
  artifactReadable: false,
  hostFiles: false,
};

type StoredChunk = { output: string; content: string; position: number };

function job(): ChatJob {
  return {
    id: 'job-1',
    chatId: 'chat',
    ownerUserId: OWNER,
    executor: 'host',
    seq: 1,
    state: 'running',
    stoppedBy: null,
    runId: 'run',
    toolCallId: 'call',
    workerInstanceId: 'worker',
    pid: 1,
    startedAt: new Date('2026-11-11T10:00:00.000Z'),
    settledAt: null,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: null,
    outputs: [],
    artifactId: null,
    artifactReadable: false,
    settings: { modelId: 'm', permissionMode: 'default' },
  };
}

function command(initial: ManagedOutput = emptyOutput()) {
  const completion = Promise.withResolvers<BashResult>();
  const listeners = new Set<(bytes: number) => void>();
  let current = initial;
  let stopResult: ManagedStopResult = { ...initial, proved: true };

  const stop = vi.fn((_cause: ManagedStopCause) => {
    completion.resolve({
      status: 'success',
      exitCode: 0,
      stdout: current.stdout,
      stderr: current.stderr,
      truncated: current.truncated,
      truncatedStreams: current.truncatedStreams,
    });

    return Promise.resolve(stopResult);
  });

  const handle: ManagedBashHandle = {
    pid: 1,
    settled: completion.promise,
    snapshot: () => current,
    onOutput: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    stop,
  };

  return {
    handle,
    stop,
    finish: completion.resolve,
    emit(stream: 'stdout' | 'stderr', text: string) {
      current = { ...current, [stream]: current[stream] + text };
      const bytes = Buffer.byteLength(text);

      for (const listener of listeners) listener(bytes);
    },
    setStopResult(result: ManagedStopResult) {
      stopResult = result;
    },
  };
}

function emptyOutput(): ManagedOutput {
  return {
    stdout: '',
    stderr: '',
    truncated: false,
    truncatedStreams: { stdout: false, stderr: false },
  };
}

function setup(
  chunks: Array<StoredChunk>,
  initial?: ManagedOutput,
  trackJob = true,
) {
  const db = {
    insert: () => ({
      values: (value: {
        output: string;
        content: Buffer;
        position: number;
      }) => {
        chunks.push({
          output: value.output,
          content: value.content.toString(),
          position: value.position,
        });

        return Promise.resolve();
      },
    }),
  };

  const tenantDb: TenantRunner = {
    runAs: <T>(_owner: string, fn: (tx: Db) => Promise<T>) => fn(asDb(db)),
  };

  const logger = { warn: vi.fn(), error: vi.fn() };
  const lifecycle = new BashJobLifecycle(tenantDb, logger, {
    startOnSettlement: vi.fn(),
  });
  const cmd = command(initial);

  if (trackJob) {
    lifecycle.trackJob(cmd.handle, job(), facts, initial ?? emptyOutput());
  }

  return { lifecycle, cmd, logger };
}

function asDb(fake: { insert: unknown }): Db {
  // SAFETY: the fake database implements the insert path used by this test.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return fake as never;
}

describe('bash job lifecycle', () => {
  let chunks: Array<StoredChunk>;
  let settle: MockInstance<ChatJobsRepository['settle']>;

  beforeEach(() => {
    chunks = [];
    // SAFETY: the store only checks whether a Chat was found.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue({} as never);
    settle = vi
      .spyOn(ChatJobsRepository.prototype, 'settle')
      .mockResolvedValue(job());
    vi.spyOn(jobNotices, 'recordJobSettlementNotice').mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flushes each stream at the 16 KiB boundary with its original offsets', async () => {
    const initial = {
      ...emptyOutput(),
      stdout: 'already stored',
      stderr: 'stored error',
    };

    const { lifecycle, cmd } = setup(chunks, initial);
    cmd.emit('stdout', 'x'.repeat(16 * 1024 - 1));
    expect(chunks).toEqual([]);
    cmd.emit('stderr', 'y');

    await vi.waitFor(() => expect(chunks).toHaveLength(2));
    expect(chunks).toEqual([
      {
        output: 'stdout',
        content: 'x'.repeat(16 * 1024 - 1),
        position: initial.stdout.length,
      },
      { output: 'stderr', content: 'y', position: initial.stderr.length },
    ]);
    await lifecycle.shutdown();
  });

  it('flushes smaller output on the one-second timer and does not append it twice', async () => {
    vi.useFakeTimers();
    const { lifecycle, cmd } = setup(chunks);

    cmd.emit('stderr', 'short output');
    await vi.advanceTimersByTimeAsync(999);
    expect(chunks).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(chunks).toHaveLength(1));
    expect(chunks).toEqual([
      { output: 'stderr', content: 'short output', position: 0 },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(chunks).toHaveLength(1);
    await lifecycle.shutdown();
  });

  it('does not schedule a flush for an empty output notification', async () => {
    vi.useFakeTimers();
    const { lifecycle, cmd } = setup(chunks);

    cmd.emit('stdout', '');
    expect(vi.getTimerCount()).toBe(0);
    await lifecycle.shutdown();
  });

  it('retries a failed final settlement with the original output and outcome', async () => {
    settle
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(job());
    const { lifecycle, cmd, logger } = setup(chunks);

    cmd.finish({
      status: 'error',
      exitCode: 9,
      stdout: 'finished output',
      stderr: 'failure details',
      truncated: false,
      truncatedStreams: { stdout: false, stderr: false },
    });
    await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(1));
    await lifecycle.settlePending();

    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle.mock.calls[1]?.[3]).toEqual({
      state: 'failed',
      result: {
        exitCode: 9,
        signal: undefined,
        truncated: { stdout: false, stderr: false },
      },
    });
    expect(chunks).toEqual([
      { output: 'stdout', content: 'finished output', position: 0 },
      { output: 'stderr', content: 'failure details', position: 0 },
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
    await lifecycle.shutdown();
  });

  it.each([
    { proved: true, state: 'cancelled' },
    { proved: false, state: 'lost' },
  ] as const)(
    'records a stop as $state when process exit proof is $proved',
    async ({ proved, state }) => {
      const { lifecycle, cmd } = setup(chunks);

      const stopped: ManagedStopResult = {
        ...emptyOutput(),
        stdout: 'captured before stop',
        proved,
      };

      cmd.setStopResult(stopped);
      await lifecycle.stop('job-1', 'assistant');

      expect(settle).toHaveBeenCalledTimes(1);
      const settlement = settle.mock.calls[0]?.[3];

      if (state === 'cancelled') {
        expect(settlement).toEqual({
          state: 'cancelled',
          stoppedBy: 'assistant',
          result: { truncated: { stdout: false, stderr: false } },
        });
      } else {
        expect(settlement).toEqual({
          state: 'lost',
          result: {
            truncated: { stdout: false, stderr: false },
            outcomeUnknown: true,
          },
        });
      }

      expect(chunks).toEqual([
        { output: 'stdout', content: 'captured before stop', position: 0 },
      ]);
    },
  );

  it.each([
    { exitCode: 0, state: 'succeeded' },
    { exitCode: 7, state: 'failed' },
  ] as const)(
    'preserves natural $state when shutdown wins before handle cleanup',
    async ({ exitCode, state }) => {
      const { lifecycle, cmd } = setup(chunks, undefined, false);
      lifecycle.trackCommand(cmd.handle);
      cmd.finish({
        status: 'success',
        exitCode,
        stdout: 'natural output',
        stderr: 'natural error',
        truncated: false,
      });

      const shutdown = lifecycle.shutdown();
      await shutdown;
      lifecycle.trackJob(cmd.handle, job(), facts, emptyOutput());
      await lifecycle.waitForCompletions();

      expect(cmd.stop).toHaveBeenCalledWith('worker');
      expect(settle.mock.calls[0]?.[3]).toEqual({
        state,
        result: {
          exitCode,
          signal: undefined,
          truncated: { stdout: false, stderr: false },
        },
      });
      expect(chunks).toEqual([
        { output: 'stdout', content: 'natural output', position: 0 },
        { output: 'stderr', content: 'natural error', position: 0 },
      ]);
    },
  );

  it('retries all pending settlements after their persistence failures', async () => {
    settle
      .mockRejectedValueOnce(new Error('first temporary failure'))
      .mockRejectedValueOnce(new Error('second temporary failure'))
      .mockResolvedValue(job());
    const first = setup(chunks);
    const second = setup(chunks);

    first.cmd.finish({
      status: 'success',
      exitCode: 0,
      stdout: 'first',
      stderr: '',
      truncated: false,
    });
    second.cmd.finish({
      status: 'success',
      exitCode: 0,
      stdout: 'second',
      stderr: '',
      truncated: false,
    });
    await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(2));
    await Promise.all([
      vi.waitFor(() => expect(first.logger.error).toHaveBeenCalled()),
      vi.waitFor(() => expect(second.logger.error).toHaveBeenCalled()),
    ]);

    await Promise.all([
      first.lifecycle.settlePending(),
      second.lifecycle.settlePending(),
    ]);

    expect(settle).toHaveBeenCalledTimes(4);
    expect(first.logger.warn).not.toHaveBeenCalled();
    expect(second.logger.warn).not.toHaveBeenCalled();
    await Promise.all([
      first.lifecycle.shutdown(),
      second.lifecycle.shutdown(),
    ]);
  });
});
