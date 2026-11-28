import { drizzle } from 'drizzle-orm/postgres-js';
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeleteJobResponseSchema,
  ErrorDetailSchema,
  ErrorReason,
  JobSchema,
  JobService,
  JobState,
  ListJobsResponseSchema,
  LostCause,
  OutputSchema,
  OutputStream,
  ReadOutputResponseSchema,
  type Job as MachineJob,
} from '@workspace/machine-protocol';
import type { ChatJob } from '../db/schema';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { MachineSessionEnd } from '../machines/machine-session';
import { MachineConnector } from '../machines/machine-connector.service';
import { MachineUnavailableError } from '../machines/machine-session-errors';
import { BashJobRegistry } from './bash-job-registry';
import { readBashJobResult } from './bash-job-registry-result';
import { BashJobRegistryRunStageService } from './bash-job-registry-run-stage.service';
import { ChatJobsRepository } from './chat-jobs.repository';
import type { Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { ChatsRepository } from '../chats/chats-repository';
import type { Chat } from '../db/schema';

const row: ChatJob = {
  id: '00000000-0000-4000-8000-000000000010',
  chatId: '00000000-0000-4000-8000-000000000011',
  ownerUserId: 'owner',
  kind: 'bash',
  seq: 1,
  state: 'running',
  stoppedBy: null,
  runId: '00000000-0000-4000-8000-000000000012',
  toolCallId: 'call-1',
  intent: null,
  command: null,
  machineName: 'host',
  daemonInstanceId: '00000000-0000-4000-8000-000000000013',
  daemonJobId: '0123456789abcdef0123456789abcdef',
  delivery: 'foreground',
  startedAt: new Date(0),
  settledAt: null,
  deadlineAt: null,
  stopRequestedAt: null,
  stopRequestedBy: null,
  result: null,
  outputs: ['stdout', 'stderr'],
  artifactId: null,
  artifactReadable: true,
  settings: { selector: 'test-model', permissionMode: 'default' },
};

function lockedChat(): Chat {
  return {
    id: row.chatId,
    ownerUserId: row.ownerUserId,
    title: null,
    visibility: 'private',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    projectId: null,
    skillCatalogBaseline: null,
    skillCatalogRebakedFrom: null,
    skillCatalogTold: null,
    workspaceRoot: null,
    workspaceExecutorId: null,
    workspaceGeneration: 0,
    workspaceTold: null,
    artifactSeq: 0,
    workspaceToldAvailable: null,
    workspaceToldFrom: null,
    workspaceDetachReason: null,
    modelSelection: null,
  };
}

function connector(): MachineConnector {
  return new MachineConnector({
    machines: undefined,
    hubVersion: 'test',
    bindIdentity: () => Promise.resolve('match'),
  });
}

function registry(
  maxBytes = BUILT_IN_DEFAULTS.tools.artifacts.maxBytes,
  machines = connector(),
): BashJobRegistry {
  const tenantDb = {
    runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      Promise.resolve(callback(drizzle.mock())),
  };

  const config = {
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        artifacts: { maxBytes },
      },
    },
  };

  const noticeRuns = { startOnSettlement: () => Promise.resolve() };
  const runWait = { wakeForChatInTransaction: () => Promise.resolve(false) };

  return new BashJobRegistry(
    tenantDb,
    machines,
    config,
    new BashJobRegistryRunStageService(tenantDb, config, noticeRuns, runWait),
  );
}

function lostJob(): MachineJob {
  return create(JobSchema, {
    id: row.daemonJobId,
    owner: row.ownerUserId,
    state: JobState.LOST,
    lostCause: LostCause.MACHINE_REBOOTED,
    stdout: create(OutputSchema, { bytes: 8n }),
    stderr: create(OutputSchema, { bytes: 0n }),
  });
}

beforeEach(() => {
  vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(lockedChat());
  vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
    undefined,
  );
  vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
    (runId, eventType, payload) =>
      Promise.resolve({
        runId,
        sequence: 1,
        eventType,
        payload,
        createdAt: new Date(),
      }),
  );
});

describe('BashJobRegistry result retention', () => {
  it('reads retained output for a lost job after a machine reboot', async () => {
    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        async *readOutput(request) {
          await Promise.resolve();

          if (request.stream === OutputStream.STDOUT)
            yield create(ReadOutputResponseSchema, {
              offset: 0n,
              data: new TextEncoder().encode('retained'),
            });
        },
      });
    });

    const client = createClient(JobService, rpc);

    const result = await readBashJobResult({
      config: { config: BUILT_IN_DEFAULTS },
      client,
      callOptions: () => ({}),
      row,
      job: lostJob(),
      credentials: [],
    });

    expect(result.output).toMatchObject({ stdout: 'retained', stderr: '' });
    expect(result.result).toMatchObject({ type: 'outcome_unknown' });
  });

  it('marks missing terminal output unavailable instead of reporting empty output', async () => {
    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        async *readOutput() {
          await Promise.resolve();
          yield* [];
          throw new ConnectError('job missing', Code.NotFound, undefined, [
            {
              desc: ErrorDetailSchema,
              value: { reason: ErrorReason.JOB_NOT_FOUND },
            },
          ]);
        },
      });
    });

    const client = createClient(JobService, rpc);

    const succeeded = create(JobSchema, {
      ...lostJob(),
      state: JobState.SUCCEEDED,
      exitCode: 0,
    });

    const result = await readBashJobResult({
      config: { config: BUILT_IN_DEFAULTS },
      client,
      callOptions: () => ({}),
      row,
      job: succeeded,
      credentials: [],
    });

    expect(result.output).toBeNull();
    expect(result.result).toMatchObject({
      status: 'error',
      type: 'unavailable',
    });
  });

  it('does not reinterpret a transport failure as a missing job', async () => {
    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        async *readOutput() {
          await Promise.resolve();
          yield* [];
          throw new ConnectError('connection reset', Code.Unavailable);
        },
      });
    });

    const client = createClient(JobService, rpc);

    await expect(
      readBashJobResult({
        config: { config: BUILT_IN_DEFAULTS },
        client,
        callOptions: () => ({}),
        row,
        job: lostJob(),
        credentials: [],
      }),
    ).rejects.toThrow('connection reset');
  });

  it('keeps a terminal daemon job when output transport fails', async () => {
    let released = false;

    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        async *readOutput() {
          await Promise.resolve();
          yield* [];
          throw new ConnectError('connection reset', Code.Unavailable);
        },
        deleteJob: () => {
          released = true;

          return create(DeleteJobResponseSchema, {});
        },
      });
    });

    const client = createClient(JobService, rpc);

    const find = vi
      .spyOn(ChatJobsRepository.prototype, 'findByDaemonJob')
      .mockResolvedValue({ ...row, delivery: 'background' });

    const settle = vi.spyOn(ChatJobsRepository.prototype, 'settle');

    const succeeded = create(JobSchema, {
      ...lostJob(),
      state: JobState.SUCCEEDED,
      exitCode: 0,
    });

    await expect(
      registry()['observe'](
        row.daemonInstanceId,
        client,
        () => ({}),
        succeeded,
      ),
    ).rejects.toBeInstanceOf(MachineUnavailableError);

    expect(find).toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(released).toBe(false);
  });

  it('caps retained output at artifact maxBytes and removes a credential prefix at the cut', async () => {
    const maxBytes = 131_072;
    const captured = `${'x'.repeat(maxBytes - 3)}secret-token`;
    const readLimits: Array<bigint> = [];

    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        async *readOutput(request) {
          await Promise.resolve();

          if (request.stream !== OutputStream.STDOUT) return;
          readLimits.push(request.limit);
          yield create(ReadOutputResponseSchema, {
            offset: 0n,
            data: new TextEncoder().encode(captured),
          });
        },
      });
    });

    const client = createClient(JobService, rpc);

    const result = await readBashJobResult({
      config: {
        config: {
          ...BUILT_IN_DEFAULTS,
          tools: {
            ...BUILT_IN_DEFAULTS.tools,
            artifacts: { maxBytes },
          },
        },
      },
      client,
      callOptions: () => ({}),
      row,
      job: lostJob(),
      credentials: ['secret-token'],
    });

    expect(readLimits).toEqual([BigInt(maxBytes)]);
    expect(result.output?.stdout).toHaveLength(maxBytes - 3);
    expect(result.result).toMatchObject({ type: 'outcome_unknown' });
    expect(result.output?.truncated).toBe(true);
    expect(result.output?.stdout).not.toContain('secret');
    expect(result.output?.stdout).not.toContain('sec');
  });
  it('removes an unstarted row and returns retryable limit_reached for job_limit', async () => {
    const machines = connector();

    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        createJob: async () => {
          await Promise.resolve();
          throw new ConnectError('limit', Code.ResourceExhausted, undefined, [
            {
              desc: ErrorDetailSchema,
              value: { reason: ErrorReason.JOB_LIMIT },
            },
          ]);
        },
      });
    });

    const client = createClient(JobService, rpc);
    const ended = new Promise<MachineSessionEnd>(() => undefined);
    vi.spyOn(machines, 'jobsClient').mockResolvedValue({
      client,
      callOptions: () => ({}),
      ended,
      instanceId: row.daemonInstanceId,
    });
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
    vi.spyOn(ChatJobsRepository.prototype, 'insert').mockResolvedValue(row);

    const deleteRunning = vi
      .spyOn(ChatJobsRepository.prototype, 'deleteRunning')
      .mockResolvedValue(undefined);

    const tenantDb = {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        Promise.resolve(callback(drizzle.mock())),
    };

    const recovery = vi
      .spyOn(NativeFilesRepository.prototype, 'recoverHostPromotion')
      .mockImplementation(({ result }) =>
        Promise.resolve({ disposition: 'recovery_won', result }),
      );

    const result = await registry(
      BUILT_IN_DEFAULTS.tools.artifacts.maxBytes,
      machines,
    ).run(
      {
        userId: row.ownerUserId,
        chatId: row.chatId,
        runId: row.runId,
        nativeDeliverySequence: 1,
        attemptId: 'attempt-1',
        toolCallId: row.toolCallId,
        configuredCredentials: [],
        tenantDb,
      },
      { name: row.machineName, local: false },
      { command: 'true' },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'limit_reached',
      message:
        'The Machine has reached its running-job limit; a later call can succeed.',
    });
    expect(deleteRunning).toHaveBeenCalledWith(
      row.chatId,
      row.ownerUserId,
      row.id,
    );
    expect(recovery).toHaveBeenCalled();
  });
  it('records an unknown result and keeps the binding after a CreateJob timeout', async () => {
    const machines = connector();
    let createdId: string | undefined;

    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        createJob: async (request) => {
          createdId = request.jobId;
          await Promise.resolve();
          throw new ConnectError('deadline', Code.DeadlineExceeded);
        },
        listJobs: () =>
          create(ListJobsResponseSchema, {
            jobs: [
              create(JobSchema, {
                id: createdId,
                owner: row.ownerUserId,
                state: JobState.RUNNING,
              }),
            ],
          }),
      });
    });

    const client = createClient(JobService, rpc);
    vi.spyOn(machines, 'jobsClient').mockResolvedValue({
      client,
      callOptions: () => ({}),
      ended: new Promise<MachineSessionEnd>(() => undefined),
      instanceId: row.daemonInstanceId,
    });
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
    vi.spyOn(ChatJobsRepository.prototype, 'insert').mockResolvedValue(row);

    const settle = vi
      .spyOn(ChatJobsRepository.prototype, 'settle')
      .mockResolvedValue(row);

    const recordNativeResult = vi
      .spyOn(NativeFilesRepository.prototype, 'recoverHostPromotion')
      .mockImplementation(({ result }) =>
        Promise.resolve({ disposition: 'recovery_won', result }),
      );

    const deleteRunning = vi
      .spyOn(ChatJobsRepository.prototype, 'deleteRunning')
      .mockResolvedValue(undefined);

    const tenantDb = {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        Promise.resolve(callback(drizzle.mock())),
    };

    await expect(
      registry(BUILT_IN_DEFAULTS.tools.artifacts.maxBytes, machines).run(
        {
          userId: row.ownerUserId,
          chatId: row.chatId,
          runId: row.runId,
          nativeDeliverySequence: 1,
          attemptId: 'attempt-1',
          toolCallId: row.toolCallId,
          configuredCredentials: [],
          tenantDb,
        },
        { name: row.machineName, local: false },
        { command: 'true' },
      ),
    ).resolves.toMatchObject({ type: 'outcome_unknown' });

    expect(recordNativeResult).toHaveBeenCalledOnce();
    expect(settle).not.toHaveBeenCalled();
    expect(deleteRunning).not.toHaveBeenCalled();
  });

  it('settles lost when CreateJob fails and ListJobs confirms the id is unknown', async () => {
    const machines = connector();

    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        createJob: async () => {
          await Promise.resolve();
          throw new ConnectError('connection reset', Code.Unavailable);
        },
        listJobs: () => create(ListJobsResponseSchema, { jobs: [] }),
      });
    });

    const client = createClient(JobService, rpc);
    const ended = new Promise<MachineSessionEnd>(() => undefined);
    vi.spyOn(machines, 'jobsClient').mockResolvedValue({
      client,
      callOptions: () => ({}),
      ended,
      instanceId: row.daemonInstanceId,
    });
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
    vi.spyOn(ChatJobsRepository.prototype, 'insert').mockResolvedValue(row);

    const settle = vi
      .spyOn(ChatJobsRepository.prototype, 'settle')
      .mockResolvedValue(row);

    vi.spyOn(
      NativeFilesRepository.prototype,
      'recoverHostPromotion',
    ).mockResolvedValue({
      disposition: 'recovery_won',
      result: {
        status: 'error',
        type: 'outcome_unknown',
        message: 'unknown',
      },
    });

    const tenantDb = {
      runAs: async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(drizzle.mock()),
    };

    await expect(
      registry(BUILT_IN_DEFAULTS.tools.artifacts.maxBytes, machines).run(
        {
          userId: row.ownerUserId,
          chatId: row.chatId,
          runId: row.runId,
          nativeDeliverySequence: 1,
          attemptId: 'attempt-1',
          toolCallId: row.toolCallId,
          configuredCredentials: [],
          tenantDb,
        },
        { name: row.machineName, local: false },
        { command: 'true' },
      ),
    ).resolves.toMatchObject({ type: 'outcome_unknown' });
    const settlement = settle.mock.calls[0]?.[3];
    expect(settlement?.state).toBe('lost');
    expect(settlement?.result?.outputUnavailable).toBe(true);
  });

  afterEach(() => vi.restoreAllMocks());
});
