import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  resetManagedExecutorForTests,
  type BashResult,
} from '@workspace/bash-executor';
import { bashTool, toToolResult } from './bash';
import { runTool } from './runner';
import { type ToolContext } from './types';

function testContext(
  toolCallId = 'call-1',
  onNativeMutationUnknown?: () => void,
): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    toolCallId,
    nativeExecutorId: 'host',
    nativeDeliverySequence: 1,
    tenantDb: {
      runAs: async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    ...(onNativeMutationUnknown && { onNativeMutationUnknown }),
  };
}

describe('bash durable admission', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetManagedExecutorForTests();
  });

  it('returns a proven timeout with partial output and admits the next call', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-timeout-'));
    const context = testContext();
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);
    try {
      const timedOut = await runTool(
        bashTool,
        {
          command:
            'printf partial-stdout; printf partial-stderr >&2; while true; do :; done',
        },
        context,
        0.05,
      );

      expect(timedOut).toMatchObject({
        status: 'error',
        type: 'timed_out',
      });
      if (timedOut.status === 'error') {
        expect(timedOut.message).toContain('partial-stdout');
        expect(timedOut.message).toContain('partial-stderr');
      }

      const next = await runTool(
        bashTool,
        { command: 'printf next' },
        { ...context, toolCallId: 'call-2' },
        0.05,
      );
      expect(next).toMatchObject({
        status: 'success',
        stdout: 'next',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps user cancellation separate from the effective timeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-cancel-'));
    const abort = new AbortController();
    const context = {
      ...testContext(),
      abortSignal: abort.signal,
    };
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);
    try {
      const resultPromise = runTool(
        bashTool,
        { command: 'while true; do :; done' },
        context,
        5,
      );
      setTimeout(() => abort.abort(), 20);

      await expect(resultPromise).resolves.toMatchObject({
        status: 'error',
        type: 'cancelled',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('falls back to an unknown outcome when result persistence exceeds the grace', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'bash-persistence-timeout-'),
    );
    const context = testContext();
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      () => new Promise(() => {}),
    );
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);
    const startedAt = Date.now();
    try {
      const result = await runTool(
        bashTool,
        { command: 'while true; do :; done' },
        context,
        0.05,
      );

      expect(result).toMatchObject({
        status: 'error',
        type: 'outcome_unknown',
      });
      expect(Date.now() - startedAt).toBeLessThan(1500);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('releases a pending durable admission when interrupted before begin resolves', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-pending-begin-'));
    const firstPath = join(directory, 'late-effect');
    const secondPath = join(directory, 'next-effect');
    const context = testContext();
    let resolveFirstBegin!: (value: undefined) => void;
    const firstBegin = new Promise<undefined>((resolve) => {
      resolveFirstBegin = resolve;
    });
    const begin = vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockReturnValueOnce(firstBegin)
      .mockResolvedValue(undefined);
    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockResolvedValue({
        runId: 'run',
        sequence: 1,
        eventType: 'native.result',
        payload: null,
        createdAt: new Date(),
      });
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);
    try {
      const first = runTool(
        bashTool,
        { command: `printf late > '${firstPath}'` },
        context,
        0.05,
      );
      await expect(first).resolves.toMatchObject({
        status: 'error',
        type: 'outcome_unknown',
      });

      const next = await runTool(
        bashTool,
        { command: `printf next > '${secondPath}'` },
        { ...context, toolCallId: 'call-2' },
        5,
      );
      expect(next).toMatchObject({ status: 'success' });
      await expect(readFile(secondPath, 'utf8')).resolves.toBe('next');

      resolveFirstBegin(undefined);
      await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(2));
      await expect(readFile(firstPath, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(begin).toHaveBeenCalledTimes(2);
    } finally {
      resolveFirstBegin(undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { truncated: true, note: '\nOutput was truncated.' },
    { truncated: false, note: '' },
  ])(
    'maps timed-out output and truncation=$truncated into the error message',
    ({ truncated, note }) => {
      const result: BashResult = {
        status: 'error',
        type: 'timed_out',
        durationMs: 100,
        stdout: 'partial stdout',
        stderr: 'partial stderr',
        truncated,
      };
      expect(toToolResult(result)).toEqual({
        status: 'error',
        type: 'timed_out',
        message: `Command exceeded its deadline of 100 ms.\nstdout:\npartial stdout\nstderr:\npartial stderr${note}`,
      });
    },
  );

  it('does not start a command when the durable attempt cannot commit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const path = join(directory, 'effect');
    const context: ToolContext = {
      userId: 'owner',
      chatId: 'chat',
      runId: 'run',
      toolCallId: 'call',
      nativeExecutorId: 'host',
      nativeDeliverySequence: 1,
      tenantDb: {
        runAs: () => Promise.reject(new Error('Database unavailable')),
      },
    };
    try {
      const result = await runTool(
        bashTool,
        { command: `printf effect > '${path}'` },
        context,
        5,
      );
      expect(result).toMatchObject({
        status: 'error',
        type: 'outcome_unknown',
        message:
          'The host command or mutation did not settle before interruption. Do not repeat it automatically.',
      });
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('releases the process slot when begin fails before the attempt is committed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const context = testContext();
    const begin = vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);
    try {
      await expect(
        bashTool.execute(context, { command: 'printf first' }),
      ).rejects.toThrow('Database unavailable');
      const result = await bashTool.execute(
        { ...context, toolCallId: 'call-2' },
        { command: 'printf second' },
      );

      expect(result).toMatchObject({ status: 'success', stdout: 'second' });
      expect(begin).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('releases the process slot when begin returns a refusal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const context = testContext();
    const begin = vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockResolvedValueOnce({
        status: 'error',
        type: 'executor_unavailable',
        message: 'This Run cannot use this native executor.',
      })
      .mockResolvedValueOnce(undefined);
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);
    try {
      await expect(
        bashTool.execute(context, { command: 'printf first' }),
      ).resolves.toMatchObject({ type: 'executor_unavailable' });
      const result = await bashTool.execute(
        { ...context, toolCallId: 'call-2' },
        { command: 'printf second' },
      );

      expect(result).toMatchObject({ status: 'success', stdout: 'second' });
      expect(begin).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('turns a failed result append into an unknown host outcome', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const onNativeMutationUnknown = vi.fn();
    const context = testContext('call-1', onNativeMutationUnknown);
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockRejectedValue(
      new Error('event log unavailable'),
    );
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);
    try {
      const result = await runTool(
        bashTool,
        { command: 'printf completed' },
        context,
        5,
      );

      expect(result).toMatchObject({
        status: 'error',
        type: 'outcome_unknown',
      });
      expect(onNativeMutationUnknown).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
