import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
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

  it.each([
    {
      label: 'an unknown key',
      input: { command: 'printf never', extra: true },
    },
    {
      label: 'a non-string environment value',
      input: { command: 'printf never', env: { VALUE: 1 } },
    },
  ])('rejects $label before durable admission', async ({ input }) => {
    const begin = vi.spyOn(NativeFilesRepository.prototype, 'begin');

    await expect(
      runTool(bashTool, input, testContext(), 5),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_input',
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it('uses absolute and relative cwd values per call, then returns to the default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-cwd-'));
    const nested = join(directory, 'nested');
    const relativeCwd = 'nested';
    await mkdir(nested);
    const begin = vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockResolvedValue(undefined);
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
        runTool(
          bashTool,
          { command: 'printf absolute > absolute-effect', cwd: nested },
          testContext(),
          5,
        ),
      ).resolves.toMatchObject({ status: 'success' });
      await expect(
        readFile(join(nested, 'absolute-effect'), 'utf8'),
      ).resolves.toBe('absolute');

      await expect(
        runTool(
          bashTool,
          { command: 'printf relative > relative-effect', cwd: relativeCwd },
          { ...testContext('call-2'), nativeDeliverySequence: 1 },
          5,
        ),
      ).resolves.toMatchObject({ status: 'success' });
      await expect(
        readFile(join(nested, 'relative-effect'), 'utf8'),
      ).resolves.toBe('relative');

      await expect(
        runTool(
          bashTool,
          { command: 'printf default > default-effect' },
          { ...testContext('call-3'), nativeDeliverySequence: 1 },
          5,
        ),
      ).resolves.toMatchObject({ status: 'success' });
      await expect(
        readFile(join(directory, 'default-effect'), 'utf8'),
      ).resolves.toBe('default');

      expect(begin).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ operation: 'bash', path: nested }),
      );
      expect(begin).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ operation: 'bash', path: nested }),
      );
      expect(begin).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ operation: 'bash', path: directory }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses missing, regular-file, and mode-000 cwd values before recording an attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-cwd-invalid-'));
    const regularFile = join(directory, 'regular-file');
    const lockedDirectory = join(directory, 'locked');
    await writeFile(regularFile, 'not a directory');
    await mkdir(lockedDirectory);
    await chmod(lockedDirectory, 0o000);
    const begin = vi.spyOn(NativeFilesRepository.prototype, 'begin');
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      for (const cwd of [
        join(directory, 'missing'),
        regularFile,
        lockedDirectory,
      ]) {
        const result = await runTool(
          bashTool,
          { command: 'touch should-not-run', cwd },
          testContext(`invalid-${cwd}`),
          5,
        );
        expect(result).toMatchObject({ status: 'error', type: 'unavailable' });
        if (result.status === 'error') {
          expect(result.message).toContain('literal');
        }
      }
      expect(begin).not.toHaveBeenCalled();
    } finally {
      await chmod(lockedDirectory, 0o700);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('adds env values to the fixed base without inheriting the parent environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-env-'));
    const begin = vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockResolvedValue(undefined);
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
    vi.stubEnv('LLAME_HOST_ONLY_SECRET', 'must-not-reach-child');
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const result = await runTool(
        bashTool,
        {
          command:
            'printf "%s\\n" "$LANG" "${HOME:+set}" "${TMPDIR:+set}" "$USER" "$LOGNAME" "$TERM" "$BASH_TEST_ADDITION" "${LLAME_HOST_ONLY_SECRET-<unset>}"',
          env: { BASH_TEST_ADDITION: 'declared-value' },
        },
        testContext(),
        5,
      );

      expect(result).toMatchObject({ status: 'success' });
      if (result.status === 'success') {
        expect(result.stdout).toBe(
          [
            'C.UTF-8',
            process.env.HOME === undefined ? '' : 'set',
            process.env.TMPDIR === undefined ? '' : 'set',
            process.env.USER ?? '',
            process.env.LOGNAME ?? '',
            'dumb',
            'declared-value',
            '<unset>',
            '',
          ].join('\n'),
        );
      }
      expect(begin).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects env collisions before durable admission and names the key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-env-collision-'));
    const begin = vi.spyOn(NativeFilesRepository.prototype, 'begin');
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const result = await runTool(
        bashTool,
        { command: 'printf never', env: { PATH: '/tmp' } },
        testContext(),
        5,
      );
      expect(result).toMatchObject({
        status: 'error',
        type: 'unavailable',
      });
      if (result.status !== 'error') {
        throw new Error('Expected an unavailable result');
      }
      expect(result.message).toContain('PATH');
      expect(begin).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
