import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { BashProcessLimiter } from '@workspace/bash-executor';

import { ChatsRepository } from '../chats/chats-repository';
import { type ChatJob } from '../db/schema';
import { type MockInstance } from 'vitest';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import {
  ChatJobsRepository,
  type JobSettlement,
} from '../jobs/chat-jobs.repository';
import { JobPromotionError } from '../jobs/job-promotion-error';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import * as hostFiles from './artifacts/host-files';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { bashTool } from './bash';
import { type ToolContext } from './types';

// SAFETY: the fake implements only the members the runtime calls.
// eslint-disable-next-line typescript/no-unsafe-type-assertion
const asDb = (fake: { insert: unknown }): Db => fake as never;

/**
 * The real registry and a real `bash` child, with the database seam faked at
 * the repositories the job runtime and the tool call.
 */
describe('async host bash through the tool', () => {
  let directory: string;
  let registry: BashJobRegistry;
  let limiter: BashProcessLimiter;
  let inserted: Array<ChatJob>;
  let settlements: Array<JobSettlement>;
  let begin: MockInstance<NativeFilesRepository['begin']>;
  let appended: Array<unknown>;
  let insertArtifact: MockInstance<ArtifactsRepository['insertArtifact']>;

  function context(overrides: Partial<ToolContext> = {}): ToolContext {
    // The tables the job runtime writes; everything else is spied above.
    const chain = { where: () => Promise.resolve() };

    const db = {
      transaction: <T>(fn: (tx: Db) => Promise<T>) => fn(asDb(db)),
      update: () => ({ set: () => chain }),
      delete: () => chain,
      insert: () => ({ values: () => Promise.resolve() }),
    };

    return {
      configuredCredentials: [],
      userId: 'owner',
      chatId: 'chat',
      runId: 'run',
      toolCallId: 'call-1',
      nativeExecutorId: 'host',
      nativeDeliverySequence: 1,
      bashProcessLimiter: limiter,
      bashJobs: registry,
      jobSettings: { modelId: 'm', effort: 'high', permissionMode: 'default' },
      artifactReadable: true,
      permissionPolicy: compileTestPermissionPolicy(),
      tenantDb: {
        runAs: <T>(_user: string, callback: (tx: Db) => Promise<T>) =>
          callback(asDb(db)),
      },
      ...overrides,
    };
  }

  const run = (
    input: { command: string; unlimited?: boolean },
    overrides: Partial<ToolContext> = {},
    env?: Record<string, string>,
  ) =>
    bashTool.execute(context(overrides), {
      ...input,
      ...(env && { env }),
      cwd: directory,
      async: true,
    });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bash-async-runtime-'));
    // Host artifact files land under $TMPDIR; keep them inside the owned root.
    vi.stubEnv('TMPDIR', directory);
    limiter = new BashProcessLimiter(1);
    inserted = [];
    settlements = [];
    appended = [];

    const tenantDb = context().tenantDb;

    registry = new BashJobRegistry(
      tenantDb,
      { instanceId: crypto.randomUUID() },
      { config: BUILT_IN_DEFAULTS },
    );
    begin = vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockResolvedValue(undefined);
    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      (_run, _type, payload) => {
        appended.push(payload);

        return Promise.resolve({
          runId: 'run',
          sequence: 1,
          eventType: 'native.result',
          payload: null,
          createdAt: new Date(),
        });
      },
    );
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(7);
    vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(
      // SAFETY: only presence is checked.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      {} as never,
    );
    vi.spyOn(ChatJobsRepository.prototype, 'insert').mockImplementation(
      (job) => {
        // SAFETY: the row echoes the fields the registry reads.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        const row: ChatJob = {
          ...job,
          id: 'job-1',
          artifactId: null,
          deadlineAt: job.deadlineAt ?? null,
        } as never;

        inserted.push(row);

        return Promise.resolve(row);
      },
    );
    vi.spyOn(ChatJobsRepository.prototype, 'settle').mockImplementation(
      (_c, _o, _j, settlement) => {
        settlements.push(settlement);

        // SAFETY: the store checks only that a row came back.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        return Promise.resolve({} as ChatJob);
      },
    );
    insertArtifact = vi
      .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
      .mockResolvedValue({ id: 'art-1', createdAt: new Date() });
    vi.spyOn(ArtifactsRepository.prototype, 'insertParts').mockResolvedValue();
    vi.spyOn(ChatJobsRepository.prototype, 'findById').mockResolvedValue(
      undefined,
    );
  });
  afterEach(async () => {
    await registry.shutdown();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  const settled = (count = 1) =>
    vi.waitFor(() => expect(settlements).toHaveLength(count));

  it('returns the job locator, records one result, and stores the starting facts', async () => {
    const result = await run({ command: 'printf hi' });

    expect(result).toMatchObject({
      status: 'success',
      backgrounded: true,
      cause: 'async',
      job: 'job://bash-7',
    });
    expect(appended).toEqual([{ toolCallId: 'call-1', result }]);
    expect(inserted[0]).toMatchObject({
      seq: 7,
      chatId: 'chat',
      ownerUserId: 'owner',
      runId: 'run',
      toolCallId: 'call-1',
      executor: 'bash',
      artifactReadable: true,
      settings: { modelId: 'm', effort: 'high', permissionMode: 'default' },
    });
    await settled();
    expect(settlements[0]).toMatchObject({
      state: 'succeeded',
      result: { exitCode: 0 },
    });
  });

  it('runs the shell text in the given directory with the given environment', async () => {
    await run(
      { command: 'printf "$MARK" > mark; pwd -P > where' },
      { toolCallId: 'call-1' },
      { MARK: 'x' },
    );
    await settled();
    await expect(readFile(join(directory, 'mark'), 'utf8')).resolves.toBe('x');
    await expect(readFile(join(directory, 'where'), 'utf8')).resolves.toBe(
      `${await realpath(directory)}\n`,
    );
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    'a readable=%s Run stores %s artifact for a large output',
    async (readable, written) => {
      await run(
        { command: 'head -c 3000 /dev/zero | tr "\\0" a' },
        { artifactReadable: readable },
      );
      await settled();
      // Shutdown awaits the settlement still in flight, artifact included.
      await registry.shutdown();
      expect(insertArtifact).toHaveBeenCalledTimes(written);
    },
  );

  it.each([
    [true, 1],
    [false, 0],
  ])(
    'a hostFiles=%s Run writes %s host file sets after the settlement',
    async (files, written) => {
      const write = vi
        .spyOn(hostFiles, 'writeArtifactHostFiles')
        .mockResolvedValue(undefined);

      await run(
        { command: 'head -c 3000 /dev/zero | tr "\\0" a' },
        { artifactHostFiles: files },
      );
      await settled();
      await registry.shutdown();
      expect(write).toHaveBeenCalledTimes(written);

      if (written === 1)
        expect(write.mock.calls[0]?.[0]).toMatchObject({ toolName: 'bash' });
    },
  );

  it('stores a lifetime deadline, and none for an allowed unlimited job', async () => {
    const before = Date.now();

    await run({ command: 'true' });
    await settled();

    const deadline = inserted[0]?.deadlineAt?.getTime() ?? 0;

    expect(deadline).toBeGreaterThanOrEqual(
      before + BUILT_IN_DEFAULTS.tools.jobs.maxSeconds * 1000,
    );
    await run(
      { command: 'true', unlimited: true },
      { allowUnlimitedJobs: true, toolCallId: 'call-2' },
    );
    await settled(2);
    expect(inserted[1]?.deadlineAt).toBeNull();
  });

  it('refuses an unlimited job when the operator does not allow it, before any attempt', async () => {
    const result = await run({ command: 'true', unlimited: true });

    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
    expect(begin).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it('keeps the slot while the job runs and frees it when the job ends', async () => {
    await run({ command: 'sleep 30' });
    expect(limiter.tryAcquire()).toBeNull();
    await registry.stop('job-1', 'owner');
    await vi.waitFor(() => expect(limiter.tryAcquire()).not.toBeNull());
  });

  it('frees the slot when no command starts', async () => {
    await registry.shutdown();

    const result = await run({ command: 'true' });

    expect(result).toMatchObject({ status: 'error', type: 'unavailable' });
    expect(appended).toHaveLength(1);
    expect(limiter.tryAcquire()).not.toBeNull();
  });

  it('answers executor_unavailable without a worker job runtime, and frees the slot', async () => {
    const result = await run(
      { command: 'true' },
      { bashJobs: undefined, jobSettings: undefined },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(begin).not.toHaveBeenCalled();
    expect(limiter.tryAcquire()).not.toBeNull();
  });

  it('records a known cancelled result and starts nothing for a Run aborted before the spawn', async () => {
    const abort = new AbortController();

    // The abort lands while the attempt is being recorded.
    begin.mockImplementation(() => {
      abort.abort();

      return Promise.resolve(undefined);
    });

    const result = await run(
      { command: 'touch started' },
      { abortSignal: abort.signal },
    );

    expect(result).toMatchObject({ status: 'error', type: 'cancelled' });
    expect(appended).toEqual([{ toolCallId: 'call-1', result }]);
    expect(inserted).toEqual([]);
    expect(limiter.tryAcquire()).not.toBeNull();
  });

  it('returns the recorded result of a replayed attempt without starting again', async () => {
    const prior = {
      status: 'error' as const,
      type: 'outcome_unknown',
      message: 'prior',
    };

    begin.mockResolvedValue(prior);

    await expect(run({ command: 'touch started' })).resolves.toEqual(prior);
    expect(inserted).toEqual([]);
    expect(appended).toEqual([]);
    expect(limiter.tryAcquire()).not.toBeNull();
  });

  describe('a promotion that fails', () => {
    it('after a proved stop returns timed_out with the output and the failed-move message', async () => {
      vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockRejectedValue(
        new Error('no number'),
      );

      const result = await run({ command: 'printf seen; sleep 30' });

      expect(result).toMatchObject({ status: 'error', type: 'timed_out' });
      expect(result.status === 'error' ? result.message : '').toMatch(
        /^timed out, \d+\.\d s\n/u,
      );
      expect(result.status === 'error' ? result.message : '').toContain(
        'The move to a background job failed; the command was stopped.',
      );
      expect(appended).toHaveLength(1);
      expect(inserted).toEqual([]);
      await vi.waitFor(() => expect(limiter.tryAcquire()).not.toBeNull());
    });

    it('after an unproved stop returns outcome_unknown', async () => {
      vi.spyOn(registry, 'promote').mockImplementation((handle) =>
        Promise.reject(
          new JobPromotionError(
            {
              proved: false,
              stdout: '',
              stderr: '',
              truncated: false,
              truncatedStreams: { stdout: false, stderr: false },
            },
            { cause: new Error('db') },
          ),
        ).finally(() => void handle.stop('run')),
      );

      const result = await run({ command: 'sleep 30' });

      expect(result).toMatchObject({
        status: 'error',
        type: 'outcome_unknown',
      });
      expect(result.status === 'error' ? result.message : '').toContain(
        'could not be proven empty',
      );
      expect(appended).toHaveLength(1);
    });

    it('rethrows an error that is not a promotion error and records nothing', async () => {
      vi.spyOn(registry, 'promote').mockRejectedValue(new Error('unexpected'));

      await expect(run({ command: 'sleep 30' })).rejects.toThrow('unexpected');
      expect(appended).toEqual([]);
    });
  });
});
