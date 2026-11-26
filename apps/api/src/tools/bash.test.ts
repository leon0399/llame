import { drizzle } from 'drizzle-orm/postgres-js';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import {
  CreateJobFailureReason,
  CreateJobFailureSchema,
  CreateJobResponseSchema,
  JobSchema,
  JobService,
  JobState,
} from '@workspace/machine-protocol';
import { type BashResult } from '@workspace/bash-executor';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { type Db } from '../db/tenant-db.service';
import type { Chat, ChatJob } from '../db/schema';
import { ChatsRepository } from '../chats/chats-repository';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { BashJobRegistryRunStageService } from '../jobs/bash-job-registry-run-stage.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { MachineConnector } from '../machines/machine-connector.service';
import { bashTool } from './bash';
import { toToolResult } from './bash-result';
import { runTool } from './runner';
import { type ToolContext } from './types';

function testContext(): ToolContext {
  const db: Db = drizzle.mock();

  const tenantDb = {
    runAs: async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  };

  return {
    configuredCredentials: [],
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    attemptId: 'attempt-1',
    toolCallId: 'call-1',
    localMachine: 'host-a',
    defaultMachine: 'host-a',
    permissionPolicy: compileTestPermissionPolicy(),
    jobSettings: { selector: 'test-model', permissionMode: 'default' },
    tenantDb,
  };
}

function lockedChat(): Chat {
  return {
    id: 'chat',
    ownerUserId: 'owner',
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

function runStage(
  tenantDb: ToolContext['tenantDb'],
): BashJobRegistryRunStageService {
  return new BashJobRegistryRunStageService(
    tenantDb,
    { config: BUILT_IN_DEFAULTS },
    { startOnSettlement: () => Promise.resolve(undefined) },
    { wakeForChatInTransaction: () => Promise.resolve(false) },
  );
}

describe('bash input validation', () => {
  it.each([
    {
      label: 'an unknown key',
      input: { command: 'printf never', extra: true },
    },
    {
      label: 'a non-string environment value',
      input: { command: 'printf never', env: { VALUE: 1 } },
    },
  ])('rejects $label before dispatch', async ({ input }) => {
    await expect(
      runTool(bashTool, input, testContext(), 5),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_input',
    });
  });
});

describe('bash daemon job dispatch', () => {
  beforeEach(() => {
    vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(
      lockedChat(),
    );
  });
  afterEach(() => vi.restoreAllMocks());
  it('records a promoted Bash result after JobService dispatch', async () => {
    const row: ChatJob = {
      id: '00000000-0000-4000-8000-000000000010',
      chatId: 'chat',
      ownerUserId: 'owner',
      kind: 'bash',
      seq: 1,
      state: 'running',
      stoppedBy: null,
      runId: 'run',
      toolCallId: 'call-1',
      machineName: 'host-a',
      daemonInstanceId: '00000000-0000-4000-8000-000000000013',
      daemonJobId: '0123456789abcdef0123456789abcdef',
      startedAt: new Date(0),
      settledAt: null,
      deadlineAt: null,
      stopRequestedAt: null,
      stopRequestedBy: null,
      result: null,
      outputs: ['stdout', 'stderr'],
      artifactId: null,
      artifactReadable: false,
      settings: { selector: 'test-model', permissionMode: 'default' },
    };

    const sequence: Array<string> = [];

    const recordAttempt = vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockImplementation(() => {
        sequence.push('native.attempt');

        return Promise.resolve(undefined);
      });

    const recordResult = vi
      .spyOn(NativeFilesRepository.prototype, 'recoverHostPromotion')
      .mockImplementation((input) => {
        sequence.push('native.result');

        return Promise.resolve({
          disposition: 'recovery_won',
          result: input.result,
        });
      });

    const requests: Array<unknown> = [];

    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        createJob(request) {
          sequence.push('CreateJob');
          requests.push(request);

          return create(CreateJobResponseSchema, {
            result: {
              case: 'job',
              value: create(JobSchema, {
                id: request.jobId,
                owner: request.owner,
                state: JobState.RUNNING,
              }),
            },
          });
        },
        async *watchJobs() {
          await new Promise<never>(() => undefined);
          yield* [];
        },
      });
    });

    const connector = new MachineConnector({
      machines: undefined,
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
    });

    const ended = new Promise<never>(() => undefined);
    vi.spyOn(connector, 'jobsClient').mockResolvedValue({
      client: createClient(JobService, rpc),
      callOptions: () => ({}),
      ended,
      instanceId: row.daemonInstanceId,
    });

    const reserveSeq = vi
      .spyOn(ArtifactsRepository.prototype, 'nextSeq')
      .mockResolvedValue(1);

    const insert = vi
      .spyOn(ChatJobsRepository.prototype, 'insert')
      .mockImplementation(() => {
        sequence.push('binding');

        return Promise.resolve(row);
      });

    const tenantDb = testContext().tenantDb;

    const bashJobs = new BashJobRegistry(
      tenantDb,
      connector,
      { config: BUILT_IN_DEFAULTS },
      runStage(tenantDb),
    );

    await expect(
      runTool(
        bashTool,
        {
          command: 'printf queued',
          cwd: '/srv/work',
          env: { MODE: 'test' },
        },
        {
          ...testContext(),
          bashJobs,
          bashBackgroundAfterSeconds: 0,
        },
        5,
      ),
    ).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
      job: 'job://bash-1',
      cause: 'time',
    });
    expect(requests).toEqual([
      expect.objectContaining({
        owner: 'owner',
        command: 'printf queued',
        cwd: '/srv/work',
        env: { MODE: 'test' },
      }),
    ]);
    expect(sequence).toEqual([
      'native.attempt',
      'binding',
      'CreateJob',
      'native.result',
    ]);
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run',
        userId: 'owner',
        operation: 'bash',
        toolCallId: 'call-1',
      }),
    );
    expect(recordResult).toHaveBeenCalledOnce();
    expect(recordResult.mock.calls[0]?.[0].result).toMatchObject({
      status: 'success',
      backgrounded: true,
      cause: 'time',
    });
    expect(reserveSeq).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        machineName: 'host-a',
      }),
    );
    expect(insert.mock.calls[0]?.[0].deadlineAt).toBeInstanceOf(Date);
    expect(requests[0]).toMatchObject({
      timeout: { seconds: BigInt(BUILT_IN_DEFAULTS.tools.jobs.maxSeconds) },
    });
  });
  it('records a known CreateJob refusal and removes its unstarted binding', async () => {
    const sequence: Array<string> = [];

    const rpc = createRouterTransport((router) => {
      router.service(JobService, {
        createJob() {
          sequence.push('CreateJob');

          return create(CreateJobResponseSchema, {
            result: {
              case: 'failure',
              value: create(CreateJobFailureSchema, {
                reason: CreateJobFailureReason.UNAVAILABLE,
                message: 'working directory is unavailable',
              }),
            },
          });
        },
      });
    });

    const connector = new MachineConnector({
      machines: undefined,
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
    });

    const ended = new Promise<never>(() => undefined);
    vi.spyOn(connector, 'jobsClient').mockResolvedValue({
      client: createClient(JobService, rpc),
      callOptions: () => ({}),
      ended,
      instanceId: '00000000-0000-4000-8000-000000000013',
    });
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockImplementation(
      () => {
        sequence.push('native.attempt');

        return Promise.resolve(undefined);
      },
    );

    const insert = vi
      .spyOn(ChatJobsRepository.prototype, 'insert')
      .mockImplementation(() => {
        sequence.push('binding');

        return Promise.resolve({
          id: '00000000-0000-4000-8000-000000000010',
          chatId: 'chat',
          ownerUserId: 'owner',
          kind: 'bash',
          seq: 1,
          state: 'running',
          stoppedBy: null,
          runId: 'run',
          toolCallId: 'call-1',
          machineName: 'host-a',
          daemonInstanceId: '00000000-0000-4000-8000-000000000013',
          daemonJobId: '0123456789abcdef0123456789abcdef',
          startedAt: new Date(0),
          settledAt: null,
          deadlineAt: null,
          stopRequestedAt: null,
          stopRequestedBy: null,
          result: null,
          outputs: ['stdout', 'stderr'],
          artifactId: null,
          artifactReadable: false,
          settings: {
            selector: 'test-model',
            permissionMode: 'default',
          },
        });
      });

    const deleteRunning = vi
      .spyOn(ChatJobsRepository.prototype, 'deleteRunning')
      .mockImplementation(() => {
        sequence.push('delete binding');

        return Promise.resolve();
      });

    const recordResult = vi
      .spyOn(NativeFilesRepository.prototype, 'recoverHostPromotion')
      .mockImplementation((input) => {
        sequence.push('native.result');

        return Promise.resolve({
          disposition: 'recovery_won',
          result: input.result,
        });
      });

    const context = testContext();

    const bashJobs = new BashJobRegistry(
      context.tenantDb,
      connector,
      { config: BUILT_IN_DEFAULTS },
      runStage(context.tenantDb),
    );

    await expect(
      runTool(
        bashTool,
        { command: 'printf never' },
        { ...context, bashJobs },
        5,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
      message: 'working directory is unavailable',
    });
    expect(sequence).toEqual([
      'native.attempt',
      'binding',
      'CreateJob',
      'delete binding',
      'native.result',
    ]);
    expect(insert).toHaveBeenCalledOnce();
    expect(deleteRunning).toHaveBeenCalledWith(
      'chat',
      'owner',
      '00000000-0000-4000-8000-000000000010',
    );
    expect(recordResult).toHaveBeenCalledOnce();
    expect(recordResult.mock.calls[0]?.[0].result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });

    expect(sequence).not.toContain('outcome_unknown');
  });

  it('does not redispatch when the Bash attempt has no recorded result', async () => {
    const context = testContext();

    const prior = {
      status: 'error' as const,
      type: 'outcome_unknown' as const,
      message: 'A previous host command may have executed.',
    };

    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(prior);

    const connector = new MachineConnector({
      machines: undefined,
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
    });

    const createJob = vi.fn(() =>
      create(CreateJobResponseSchema, {
        result: {
          case: 'job',
          value: create(JobSchema, {
            id: '0123456789abcdef0123456789abcdef',
            owner: 'owner',
            state: JobState.RUNNING,
          }),
        },
      }),
    );

    const rpc = createRouterTransport((router) => {
      router.service(JobService, { createJob });
    });

    const client = createClient(JobService, rpc);
    const ended = new Promise<never>(() => undefined);

    const jobsClient = vi.spyOn(connector, 'jobsClient').mockResolvedValue({
      client,
      callOptions: () => ({}),
      ended,
      instanceId: '00000000-0000-4000-8000-000000000013',
    });

    const insert = vi.spyOn(ChatJobsRepository.prototype, 'insert');

    const deleteRunning = vi.spyOn(
      ChatJobsRepository.prototype,
      'deleteRunning',
    );

    const bashJobs = new BashJobRegistry(
      context.tenantDb,
      connector,
      { config: BUILT_IN_DEFAULTS },
      runStage(context.tenantDb),
    );

    await expect(
      runTool(
        bashTool,
        { command: 'printf never' },
        { ...context, bashJobs },
        5,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
    expect(jobsClient).toHaveBeenCalledOnce();
    expect(createJob).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(deleteRunning).not.toHaveBeenCalled();
  });
  it('fails closed without the admitted Run attempt', async () => {
    const context = testContext();

    const connector = new MachineConnector({
      machines: undefined,
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
    });

    const jobsClient = vi.spyOn(connector, 'jobsClient');

    const bashJobs = new BashJobRegistry(
      context.tenantDb,
      connector,
      { config: BUILT_IN_DEFAULTS },
      runStage(context.tenantDb),
    );

    await expect(
      bashTool.execute(
        { ...context, attemptId: undefined, bashJobs },
        { command: 'printf never' },
      ),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(jobsClient).not.toHaveBeenCalled();
  });
});

describe('bash result contract', () => {
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

      expect(toToolResult(result)).toEqual({
        status: 'error',
        type: 'timed_out',
        message: `timed out, 0.1 s\npartial stdout\n[stderr]\npartial stderr${note}`,
      });
    },
  );

  it('names no elapsed time for a timeout that never started a command', () => {
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

    expect(toToolResult(result)).toStrictEqual({
      status: 'success',
      exitCode: 0,
      stdout: 'out\n',
      stderr: '',
    });
  });
});
