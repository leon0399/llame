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
import { isString } from '@workspace/runtime-safety';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { Logger } from '@nestjs/common';
import { artifactDirectory } from './artifacts/host-files';
import { RunEventsRepository } from '../runs/runs-repository';
import { BashProcessLimiter, type BashResult } from '@workspace/bash-executor';
import {
  type SshClient,
  type SshRunOutcome,
  type SshRunRequest,
} from '../ssh/ssh-client';
import * as bashExecutor from '@workspace/bash-executor';
import { bashTool } from './bash';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import { managedBashContext } from './bash-limits';
import { toToolResult } from './bash-result';
import { runTool } from './runner';
import { type ToolContext } from './types';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { createWorkspaceRootCell } from './workspace-path';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { expectRedacted, stubArtifactWrites } from '../testing/support';

function testContext(
  toolCallId = 'call-1',
  onNativeMutationUnknown?: () => void,
): ToolContext {
  const db: Db = drizzle.mock({ schema });

  const tenantDb = {
    runAs: async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  };

  return {
    configuredCredentials: [],
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    toolCallId,
    nativeExecutorId: 'host',
    nativeDeliverySequence: 1,
    bashProcessLimiter: new BashProcessLimiter(64),
    bashJobs: new BashJobRegistry(
      tenantDb,
      { instanceId: crypto.randomUUID() },
      { config: BUILT_IN_DEFAULTS },
    ),
    jobSettings: { modelId: 'test-model', permissionMode: 'default' },
    permissionPolicy: compileTestPermissionPolicy(),
    tenantDb,
    ...(onNativeMutationUnknown && { onNativeMutationUnknown }),
  };
}

/** One slot, so a test sees a leaked slot as a refused next call. */
function singleSlotContext(): ToolContext {
  return { ...testContext(), bashProcessLimiter: new BashProcessLimiter(1) };
}

describe('async bash cancelled during the durable begin', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records a cancelled result and starts no job', async () => {
    const controller = new AbortController();

    const jobs = new BashJobRegistry(
      { runAs: vi.fn() },
      { instanceId: crypto.randomUUID(), jobCheck: undefined },
      { config: BUILT_IN_DEFAULTS },
    );

    const start = vi.spyOn(jobs, 'start');

    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockImplementation(
      () => {
        controller.abort(new Error('aborted'));

        return Promise.resolve(undefined);
      },
    );

    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockResolvedValue({
        runId: 'run',
        sequence: 2,
        eventType: 'native.result',
        payload: null,
        createdAt: new Date(),
      });

    const result = await bashTool.execute(
      {
        ...testContext(),
        abortSignal: controller.signal,
        jobSettings: { modelId: 'm', permissionMode: 'default' },
        bashJobs: jobs,
      },
      { command: 'printf never', async: true },
    );

    expect(result).toMatchObject({ status: 'error', type: 'cancelled' });
    expect(append.mock.calls).toEqual([
      ['run', 'native.result', { toolCallId: 'call-1', result }],
    ]);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('bash durable admission', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

  it('uses the entered root for omitted cwd and resolves relative cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bash-workspace-root-'));
    const nested = join(root, 'nested');
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

    const workspaceContext = {
      ...testContext(),
      workspaceRoot: createWorkspaceRootCell(root),
    };

    try {
      await expect(
        runTool(
          bashTool,
          { command: 'printf root > root-effect' },
          workspaceContext,
          5,
        ),
      ).resolves.toMatchObject({ status: 'success' });
      await expect(readFile(join(root, 'root-effect'), 'utf8')).resolves.toBe(
        'root',
      );

      await expect(
        runTool(
          bashTool,
          { command: 'printf nested > nested-effect', cwd: 'nested' },
          { ...workspaceContext, toolCallId: 'call-2' },
          5,
        ),
      ).resolves.toMatchObject({ status: 'success' });
      await expect(
        readFile(join(nested, 'nested-effect'), 'utf8'),
      ).resolves.toBe('nested');
      expect(begin).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ operation: 'bash', path: root }),
      );
      expect(begin).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ operation: 'bash', path: nested }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an unknown cwd scheme before starting a process', async () => {
    const begin = vi.spyOn(NativeFilesRepository.prototype, 'begin');
    await expect(
      runTool(
        bashTool,
        { command: 'printf never', cwd: 'vault://notes' },
        {
          ...testContext(),
          workspaceRoot: createWorkspaceRootCell('/tmp'),
        },
        5,
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'The working directory must be a local path.',
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it('leaves a non-local cwd literal alone when no Workspace root is entered', async () => {
    await expect(
      runTool(
        bashTool,
        { command: 'printf never', cwd: 'vault://notes' },
        testContext(),
        5,
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'unavailable',
      message:
        'Working directory argument "vault://notes" is not usable. The command did not run; the argument was taken literally with no ~ or variable expansion. List its parent or create the directory.',
    });
  });

  it('leaves an ssh:// cwd alone in a Machine Workspace', async () => {
    const runs: Array<SshRunRequest> = [];

    const client: SshClient = {
      resolve: () =>
        Promise.resolve({
          outcome: 'resolved',
          destination: { user: 'box', host: 'box', port: 22 },
        }),
      run: (request): Promise<SshRunOutcome> => {
        runs.push(request);

        const nonce =
          /printf '%s:start\\n' '([0-9a-f]+)'/u.exec(
            String(request.input),
          )?.[1] ?? '';

        return Promise.resolve({
          outcome: 'ended',
          stdout: Buffer.from(`${nonce}:start\n/home/box/work\n`),
          diagnostic: `${nonce}:start\n${nonce}:end:0\n`,
          stdoutOverflow: false,
          stderrOverflow: false,
          code: 0,
          signal: null,
        });
      },
      sshConfigText: () => undefined,
      dispose: () => undefined,
    };

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

    const result = await runTool(
      bashTool,
      { command: 'pwd', cwd: 'ssh://box/tmp' },
      {
        ...testContext(),
        sshClient: client,
        workspaceRoot: createWorkspaceRootCell('machine://devl/home/box/work'),
      },
      5,
    );

    expect(result).toMatchObject({
      status: 'success',
      stdout: '/home/box/work\n',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      destination: 'box',
      remoteCommand: ['bash', '-s'],
      resolved: { user: 'box', host: 'box', port: 22 },
    });
    expect(String(runs[0]?.input)).toContain("p='/tmp'");
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        fence: { bound: false },
        path: 'ssh://box@box:22/tmp',
      }),
    );
  });

  it('requires the local executor for a local cwd when only ssh is configured', async () => {
    const client: SshClient = {
      resolve: () => Promise.reject(new Error('a local cwd resolves nothing')),
      run: () => Promise.reject(new Error('a local cwd runs nothing')),
      sshConfigText: () => undefined,
      dispose: () => undefined,
    };

    const begin = vi.spyOn(NativeFilesRepository.prototype, 'begin');

    const result = await runTool(
      bashTool,
      { command: 'printf never', cwd: '/tmp' },
      { ...testContext(), nativeExecutorId: undefined, sshClient: client },
      5,
    );

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it('keeps ssh:// an unknown scheme without the ssh section', async () => {
    const begin = vi.spyOn(NativeFilesRepository.prototype, 'begin');

    await expect(
      runTool(
        bashTool,
        { command: 'printf never', cwd: 'ssh://box/tmp' },
        testContext(),
        5,
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it('preserves the submitted spelling of an absolute cwd', async () => {
    await expect(
      runTool(
        bashTool,
        {
          command: 'printf never',
          cwd: '/tmp/../definitely-no-such-dir',
        },
        {
          ...testContext(),
          workspaceRoot: createWorkspaceRootCell('/tmp'),
        },
        5,
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'unavailable',
      message:
        'Working directory argument "/tmp/../definitely-no-such-dir" is not usable. The command did not run; the argument was taken literally with no ~ or variable expansion. List its parent or create the directory.',
    });
  });

  it('hands the executor a projected trailing cwd string', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bash-workspace-trailing-'));
    const nested = join(root, 'nested');
    await mkdir(nested);
    const admit = vi.spyOn(bashExecutor, 'admitManagedBash');
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

    try {
      await expect(
        runTool(
          bashTool,
          { command: 'printf trailing > trailing-effect', cwd: 'nested/' },
          {
            ...testContext(),
            workspaceRoot: createWorkspaceRootCell(root),
          },
          5,
        ),
      ).resolves.toMatchObject({ status: 'success' });
      expect(admit).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: `${nested}/`,
        }),
        expect.anything(),
        expect.anything(),
      );
      await expect(
        readFile(join(nested, 'trailing-effect'), 'utf8'),
      ).resolves.toBe('trailing');
    } finally {
      await rm(root, { recursive: true, force: true });
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
          command: 'env',
          env: { BASH_TEST_ADDITION: 'declared-value' },
        },
        testContext(),
        5,
      );

      expect(result).toMatchObject({ status: 'success' });

      if (result.status === 'success') {
        expect(result).not.toHaveProperty('cut');

        if (!isString(result.stdout)) {
          throw new Error('Expected bash stdout to be a string');
        }

        // Bash and the local launcher add runtime variables such as PWD,
        // SHLVL, and _. Assert the environment contract without freezing
        // those implementation details or their ordering.
        const variables = result.stdout.split('\n');
        expect(variables).toContain('LANG=C.UTF-8');
        expect(variables).toContain('TERM=dumb');
        expect(variables).toContain('BASH_TEST_ADDITION=declared-value');
        expect(
          variables.some((line) => line.startsWith('LLAME_HOST_ONLY_SECRET=')),
        ).toBe(false);
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

  it('redacts configured credentials from the result, artifact parts, and native.result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-redact-'));
    const provider = 'PROVIDER-CANARY-7f3';
    const mcp = 'MCP-HEADER-CANARY-2b9';
    const knowledge = '/srv/knowledge/root';

    const context = {
      ...testContext(),
      artifactReadable: true,
      configuredCredentials: [provider, mcp],
    };

    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );

    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockResolvedValue({
        runId: 'run',
        sequence: 1,
        eventType: 'native.result',
        payload: null,
        createdAt: new Date(),
      });

    const insertParts = stubArtifactWrites();
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const result = await runTool(
        bashTool,
        {
          command: `printf 'provider %s\nmcp %s\nknowledge %s\n' '${provider}' '${mcp}' '${knowledge}'; seq 1 4000; printf 'stderr %s\n' '${mcp}' >&2`,
        },
        context,
        5,
      );

      expect(result).toMatchObject({ status: 'success' });
      const shown = JSON.stringify(result);
      expectRedacted(shown, [provider, mcp]);
      expect(shown).toContain(knowledge);

      const parts = insertParts.mock.calls
        .flatMap(([, written]) => written)
        .map((part) => part.content.toString('utf8'))
        .join('\n');

      expectRedacted(parts, [provider, mcp]);
      expect(parts).toContain(knowledge);

      const events = append.mock.calls
        .map(([, eventType, payload]) => JSON.stringify({ eventType, payload }))
        .join('\n');

      expectRedacted(events, [provider, mcp]);
      expect(events).toContain(knowledge);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('bounds a host stream in bytes from tools.artifacts.maxBytes', () => {
    const bounds = managedBashContext({
      ...testContext(),
      artifactMaxBytes: 131_072,
    });

    expect(bounds.outputBoundBytes).toBe(131_072);
    expect(bounds.outputBound).toBeUndefined();
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

  it('releases a pending durable admission when interrupted before begin resolves', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-pending-begin-'));
    const firstPath = join(directory, 'late-effect');
    const secondPath = join(directory, 'next-effect');
    const abort = new AbortController();
    const context = { ...singleSlotContext(), abortSignal: abort.signal };
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
        5,
      );

      setTimeout(() => abort.abort(), 20);

      await expect(first).resolves.toMatchObject({
        status: 'error',
        type: 'outcome_unknown',
      });

      const next = await runTool(
        bashTool,
        { command: `printf next > '${secondPath}'` },
        { ...context, abortSignal: undefined, toolCallId: 'call-2' },
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
    { truncated: true, note: '\n[output cut at the bound]' },
    { truncated: false, note: '' },
  ])(
    'maps timed-out output and truncation=$truncated into the error message',
    ({ truncated, note }) => {
      const result: BashResult = {
        status: 'error',
        type: 'timed_out',
        durationMs: 100,
        wallTimeMs: 100,
        stdout: 'partial stdout',
        stderr: 'partial stderr',
        truncated,
      };

      // The message is the bash text shape: the command was stopped, not
      // exited, so the header names itself and the 0.1 s measured before the
      // deadline stopped it.
      expect(toToolResult(result)).toEqual({
        status: 'error',
        type: 'timed_out',
        message: `timed out, 0.1 s\npartial stdout\n[stderr]\npartial stderr${note}`,
      });
    },
  );

  it('names no elapsed time for a timeout that never started a command', () => {
    // The admission and the SSH pre-start check can end a call before anything
    // spawns: the configured deadline is not a measurement, so no seconds.
    const result: BashResult = {
      status: 'error',
      type: 'timed_out',
      durationMs: 300_000,
      stdout: '',
      stderr: '',
      truncated: false,
    };

    expect(toToolResult(result)).toEqual({
      status: 'error',
      type: 'timed_out',
      message: 'timed out\n(no output)',
    });
  });

  it('composes a failing command as the bash text shape with its elapsed time', () => {
    const result: BashResult = {
      status: 'error',
      exitCode: 1,
      stdout: '',
      stderr: '',
      truncated: false,
      wallTimeMs: 2460,
    };

    expect(toToolResult(result)).toEqual({
      status: 'error',
      type: 'command_failed',
      message: 'exit 1, 2.5 s\n(no output)',
    });
  });

  it('drops the constant operation fields and keeps the wall time on success', () => {
    const result: BashResult = {
      status: 'success',
      exitCode: 0,
      stdout: 'out\n',
      stderr: '',
      truncated: false,
      wallTimeMs: 1240,
    };

    expect(toToolResult(result)).toStrictEqual({
      status: 'success',
      exitCode: 0,
      stdout: 'out\n',
      stderr: '',
      wallTimeMs: 1240,
    });
  });

  it('marks the executor cut with cut, not with the cap flag', () => {
    const result: BashResult = {
      status: 'success',
      exitCode: 0,
      stdout: 'prefix',
      stderr: '',
      truncated: true,
      wallTimeMs: 1240,
    };

    expect(toToolResult(result)).toStrictEqual({
      status: 'success',
      exitCode: 0,
      stdout: 'prefix',
      stderr: '',
      cut: true,
      wallTimeMs: 1240,
    });
  });

  it('omits the wall time a result never measured', () => {
    const result: BashResult = {
      status: 'success',
      exitCode: 0,
      stdout: 'out\n',
      stderr: '',
      truncated: false,
    };

    const settled = toToolResult(result);
    expect(settled).toStrictEqual({
      status: 'success',
      exitCode: 0,
      stdout: 'out\n',
      stderr: '',
    });
  });

  it('does not start a command when the durable attempt cannot commit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const path = join(directory, 'effect');

    const context: ToolContext = {
      ...testContext('call'),
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
          'Command outcome could not be established; inspect the workspace before retrying. The attempt will not be replayed automatically.',
      });
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('releases the process slot when begin fails before the attempt is committed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const context = singleSlotContext();

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
    const context = singleSlotContext();

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
      expect(onNativeMutationUnknown).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restores a Chat artifact file before the command starts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const hostRoot = await mkdtemp(join(tmpdir(), 'bash-artifact-host-'));
    vi.stubEnv('TMPDIR', hostRoot);
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
    const artifactDir = join(artifactDirectory('chat'), 'bash-1');
    const stdoutFile = join(artifactDir, 'stdout.txt');
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    await writeFile(stdoutFile, 'tampered\n');
    const createdAt = new Date('2026-11-02T12:00:00.000Z');
    vi.spyOn(
      ArtifactsRepository.prototype,
      'listChatPartFiles',
    ).mockResolvedValue([
      {
        artifactId: 'artifact-1',
        toolName: 'bash',
        seq: 1,
        createdAt,
        name: 'stdout',
        contentType: 'text/plain',
        byteSize: 6,
      },
    ]);
    vi.spyOn(
      ArtifactsRepository.prototype,
      'findPartContent',
    ).mockResolvedValue([{ content: Buffer.from('hello\n') }]);
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const result = await bashTool.execute(
        { ...testContext(), artifactHostFiles: true },
        { command: `cat '${stdoutFile}'` },
      );

      expect(result).toMatchObject({ status: 'success', stdout: 'hello\n' });
    } finally {
      await rm(hostRoot, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('skips the reconcile when the Run keeps no host files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const hostRoot = await mkdtemp(join(tmpdir(), 'bash-artifact-host-'));
    vi.stubEnv('TMPDIR', hostRoot);
    const stdoutFile = join(artifactDirectory('chat'), 'bash-1', 'stdout.txt');
    await mkdir(join(artifactDirectory('chat'), 'bash-1'), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(stdoutFile, 'tampered\n');
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
    const list = vi.spyOn(ArtifactsRepository.prototype, 'listChatPartFiles');
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const result = await bashTool.execute(
        { ...testContext() },
        { command: 'printf ready' },
      );

      expect(result).toMatchObject({ status: 'success', stdout: 'ready' });
      expect(list).not.toHaveBeenCalled();
      expect(await readFile(stdoutFile, 'utf8')).toBe('tampered\n');
    } finally {
      await rm(hostRoot, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('runs the command when the artifact files cannot be reconciled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-admission-'));
    const hostRoot = await mkdtemp(join(tmpdir(), 'bash-artifact-host-'));
    vi.stubEnv('TMPDIR', hostRoot);
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
    vi.spyOn(
      ArtifactsRepository.prototype,
      'listChatPartFiles',
    ).mockRejectedValue(new Error('the store is unavailable'));
    const warn = vi.spyOn(Logger.prototype, 'warn');
    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const result = await bashTool.execute(
        { ...testContext(), artifactHostFiles: true },
        { command: 'printf ready' },
      );

      expect(result).toMatchObject({ status: 'success', stdout: 'ready' });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Artifact file reconcile failed'),
      );
    } finally {
      await rm(hostRoot, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('bash process bound', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function stubDurableRecords() {
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

    return begin;
  }

  it('runs two commands of one step together under the default bound', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-two-'));
    const begin = stubDurableRecords();

    const context: ToolContext = {
      ...testContext(),
      bashProcessLimiter: new BashProcessLimiter(
        BUILT_IN_DEFAULTS.tools.bash.maxProcesses,
      ),
    };

    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const results = await Promise.all([
        runTool(
          bashTool,
          { command: 'sleep 0.2; printf one > one' },
          { ...context, toolCallId: 'call-1' },
          5,
        ),
        runTool(
          bashTool,
          { command: 'sleep 0.2; printf two > two' },
          { ...context, toolCallId: 'call-2' },
          5,
        ),
      ]);

      expect(results).toEqual([
        expect.objectContaining({ status: 'success' }),
        expect.objectContaining({ status: 'success' }),
      ]);
      expect(begin).toHaveBeenCalledTimes(2);
      await expect(readFile(join(directory, 'one'), 'utf8')).resolves.toBe(
        'one',
      );
      await expect(readFile(join(directory, 'two'), 'utf8')).resolves.toBe(
        'two',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses execution without worker process authority before creating an attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-no-authority-'));
    const begin = stubDurableRecords();

    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const result = await runTool(
        bashTool,
        { command: 'printf forbidden > effect' },
        { ...testContext(), bashProcessLimiter: undefined },
        5,
      );

      expect(result).toMatchObject({
        status: 'error',
        type: 'executor_unavailable',
      });
      expect(begin).not.toHaveBeenCalled();
      await expect(
        readFile(join(directory, 'effect'), 'utf8'),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses a call past the bound before an attempt and a process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bash-full-'));
    const begin = stubDurableRecords();

    const limiter = new BashProcessLimiter(
      BUILT_IN_DEFAULTS.tools.bash.maxProcesses,
    );

    const held = Array.from({ length: limiter.maxProcesses }, () =>
      limiter.tryAcquire(),
    );

    vi.stubEnv('BASH_WORKING_DIRECTORY', directory);

    try {
      const result = await runTool(
        bashTool,
        { command: 'printf never > effect' },
        { ...testContext(), bashProcessLimiter: limiter },
        5,
      );

      if (result.status !== 'error') throw new Error('Expected a refusal');

      expect(result.type).toBe('limit_reached');
      expect(result.message).toContain('64 managed commands');
      expect(result.message).toContain('A later call can succeed');
      expect(begin).not.toHaveBeenCalled();
      await expect(
        readFile(join(directory, 'effect'), 'utf8'),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });

      held[0]?.release();
      await expect(
        runTool(
          bashTool,
          { command: 'printf later > effect' },
          { ...testContext('call-2'), bashProcessLimiter: limiter },
          5,
        ),
      ).resolves.toMatchObject({ status: 'success' });
    } finally {
      for (const slot of held) slot?.release();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
