import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type ChatJob } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { ChatsRepository } from '../chats/chats-repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { buildWaitResult, waitTool } from './wait';
import { WAIT_SUSPENSION } from './wait-suspension';
import { type ToolContext } from './types';

const TX: Db = drizzle.mock({ schema });

function job(id: string, state: ChatJob['state'] = 'running'): ChatJob {
  const now = new Date();

  return {
    id,
    chatId: 'chat-id',
    ownerUserId: 'owner-id',
    executor: 'bash',
    seq: 3,
    state,
    stoppedBy: null,
    runId: 'run-id',
    toolCallId: 'call-id',
    workerInstanceId: 'worker-id',
    pid: null,
    startedAt: now,
    settledAt: state === 'running' ? null : now,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: state === 'succeeded' ? { exitCode: 0 } : null,
    outputs: [],
    artifactId: null,
    artifactReadable: false,
    settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
  };
}

function setup(rows: Readonly<Record<string, ChatJob | undefined>>) {
  const tenantDb: TenantRunner = {
    async runAs<T>(_userId: string, callback: (tx: Db) => Promise<T>) {
      return callback(TX);
    },
  };

  const beginWaitCall = vi.fn(() => true);
  const onWaitRequested = vi.fn();

  const findByLocator = vi
    .spyOn(ChatJobsRepository.prototype, 'findByLocator')
    .mockImplementation((_chatId, _ownerUserId, executor, seq) =>
      Promise.resolve(rows[`job://${executor}-${seq}`]),
    );

  vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue({
    id: 'chat-id',
    ownerUserId: 'owner-id',
    title: 'Wait owner',
    visibility: 'private',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    projectId: null,
    recencyDigestBaseline: null,
    recencyDigestTold: null,
    recencyDigestRebakedFrom: null,
    skillCatalogBaseline: null,
    skillCatalogRebakedFrom: null,
    skillCatalogTold: null,
    workspaceRoot: null,
    workspaceExecutorId: null,
    workspaceGeneration: 0,
    artifactSeq: 0,
    workspaceTold: null,
    workspaceToldFrom: null,
    workspaceToldAvailable: null,
    workspaceDetachReason: null,
  });
  vi.spyOn(
    ChatJobsRepository.prototype,
    'settleOnDeadWorkers',
  ).mockResolvedValue([]);

  const context: ToolContext = {
    userId: 'owner-id',
    chatId: 'chat-id',
    tenantDb,
    configuredCredentials: [],
    toolCallId: 'call-id',
    beginWaitCall,
    onWaitRequested,
  };

  return { context, beginWaitCall, onWaitRequested, findByLocator };
}

describe('waitTool', () => {
  afterEach(() => vi.restoreAllMocks());

  it('suspends only after every owner-scoped record locator resolves', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });

    const result = await waitTool.execute(tools.context, {
      jobs: ['job://bash-3'],
      timeout: 12,
    });

    expect(result).toBe(WAIT_SUSPENSION);
    expect(tools.beginWaitCall).toHaveBeenCalledOnce();
    expect(tools.onWaitRequested).toHaveBeenCalledOnce();
  });

  it('refuses the entire list when any record locator is unknown', async () => {
    const tools = setup({
      'job://bash-3': job('known-id'),
      'job://bash-4': undefined,
    });

    const result = await waitTool.execute(tools.context, {
      jobs: ['job://bash-3', 'job://bash-4'],
    });

    expect(result).toMatchObject({ status: 'error', type: 'not_found' });
    expect(tools.onWaitRequested).not.toHaveBeenCalled();
  });

  it('rejects output locators and out-of-range timeouts without a lookup', async () => {
    const tools = setup({});

    await expect(
      waitTool.execute(tools.context, { jobs: ['job://bash-3/stdout'] }),
    ).resolves.toMatchObject({ status: 'error', type: 'invalid_input' });
    await expect(
      waitTool.execute(tools.context, {
        jobs: ['job://bash-3'],
        timeout: 3601,
      }),
    ).resolves.toMatchObject({ status: 'error', type: 'invalid_input' });
    expect(tools.onWaitRequested).not.toHaveBeenCalled();
  });

  it('returns cancellation before resolving any locator', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });
    const controller = new AbortController();
    controller.abort();
    const context = { ...tools.context, abortSignal: controller.signal };

    await expect(
      waitTool.execute(context, { jobs: ['job://bash-3'] }),
    ).resolves.toMatchObject({ status: 'error', type: 'cancelled' });
    expect(tools.findByLocator).not.toHaveBeenCalled();
  });

  it('returns timeout if the call stops while resolving its jobs', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });
    const controller = new AbortController();
    vi.spyOn(ChatJobsRepository.prototype, 'findByLocator').mockImplementation(
      () => {
        controller.abort();

        return Promise.resolve(job('job-id'));
      },
    );
    const context = { ...tools.context, timeoutSignal: controller.signal };

    await expect(
      waitTool.execute(context, { jobs: ['job://bash-3'] }),
    ).resolves.toMatchObject({ status: 'error', type: 'timeout' });
    expect(tools.onWaitRequested).not.toHaveBeenCalled();
  });

  it('does not suspend when the call has no durable wait context', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });
    const context = { ...tools.context, toolCallId: undefined };

    await expect(
      waitTool.execute(context, { jobs: ['job://bash-3'] }),
    ).resolves.toMatchObject({ status: 'error', type: 'no_context' });
    expect(tools.onWaitRequested).not.toHaveBeenCalled();
  });

  it('uses the requested timeout to set the durable deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
    const tools = setup({ 'job://bash-3': job('job-id') });

    await waitTool.execute(tools.context, {
      jobs: ['job://bash-3'],
      timeout: 12,
    });

    expect(tools.onWaitRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        deadline: '2026-11-14T12:00:12.000Z',
      }),
    );
    vi.useRealTimers();
  });
});

describe('buildWaitResult', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns each job state, settled details, bounded output, and the running promise', async () => {
    const startedAt = new Date('2026-11-14T12:00:00.000Z');

    const running = {
      ...job('running-id'),
      seq: 4,
      startedAt,
      outputs: ['stdout'],
    };

    const settled = {
      ...job('settled-id', 'succeeded'),
      startedAt,
      settledAt: new Date(startedAt.getTime() + 2500),
      outputs: ['stdout'],
    };

    vi.spyOn(ChatJobsRepository.prototype, 'readOutputTail').mockResolvedValue(
      Buffer.from('settled output'),
    );

    const result = await buildWaitResult(
      TX,
      { chatId: 'chat-id', userId: 'owner-id' },
      [running, settled],
      'timeout',
    );

    expect(result).toMatchObject({
      status: 'success',
      ended: 'timeout',
      promise:
        'The jobs continue in the background. You get a notice when one of them settles.',
      jobs: [
        { locator: 'job://bash-4', state: 'running' },
        {
          locator: 'job://bash-3',
          state: 'succeeded',
          elapsedMs: 2500,
          exitDetail: { exitCode: 0 },
          outputs: [{ name: 'stdout', text: 'settled output' }],
        },
      ],
    });
  });
});
