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

  const beginWaitCall = vi.fn(
    (_toolCallId: string): string | undefined => undefined,
  );

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
    expect(tools.beginWaitCall).toHaveBeenCalledWith('call-id');
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

    expect(result).toMatchObject({
      status: 'error',
      type: 'not_found',
      message: 'One or more jobs were not found in this Chat.',
    });
    expect(tools.beginWaitCall).not.toHaveBeenCalled();
    expect(tools.onWaitRequested).not.toHaveBeenCalled();
  });

  it('rejects output locators and out-of-range timeouts without a lookup', async () => {
    const tools = setup({});

    await expect(
      waitTool.execute(tools.context, { jobs: ['job://bash-3/stdout'] }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_input',
      message: 'The wait arguments are invalid.',
    });
    await expect(
      waitTool.execute(tools.context, {
        jobs: ['job://bash-3'],
        timeout: 3601,
      }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_input',
      message: 'The wait arguments are invalid.',
    });
    expect(tools.beginWaitCall).not.toHaveBeenCalled();
  });

  it('rejects a mixed list containing an output locator before reserving the wait', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });

    await expect(
      waitTool.execute(tools.context, {
        jobs: ['job://bash-3', 'job://bash-3/stdout'],
      }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_input',
      message: 'The wait arguments are invalid.',
    });
    expect(tools.beginWaitCall).not.toHaveBeenCalled();
    expect(tools.findByLocator).not.toHaveBeenCalled();
  });

  it('returns cancellation before resolving any locator', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });
    const controller = new AbortController();
    controller.abort();
    const context = { ...tools.context, abortSignal: controller.signal };

    await expect(
      waitTool.execute(context, { jobs: ['job://bash-3'] }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'cancelled',
      message: 'Tool "wait" was cancelled.',
    });
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
    ).resolves.toMatchObject({
      status: 'error',
      type: 'timeout',
      message: 'Tool "wait" timed out.',
    });
    expect(tools.beginWaitCall).not.toHaveBeenCalled();
    expect(tools.onWaitRequested).not.toHaveBeenCalled();
  });

  it('names the first wait call when a second valid wait is refused', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });

    let firstCallId: string | undefined;
    tools.beginWaitCall.mockImplementation((toolCallId) => {
      if (firstCallId !== undefined) return firstCallId;

      firstCallId = toolCallId;

      return undefined;
    });

    await expect(
      waitTool.execute(
        { ...tools.context, toolCallId: 'first-call' },
        { jobs: ['job://bash-3'] },
      ),
    ).resolves.toBe(WAIT_SUSPENSION);

    const refusal = await waitTool.execute(
      { ...tools.context, toolCallId: 'second-call' },
      { jobs: ['job://bash-3'] },
    );

    expect(refusal.status).toBe('error');

    if (refusal.status !== 'error') {
      throw new Error('Expected the second wait to be refused.');
    }

    expect(refusal.type).toBe('wait_already_requested');
    expect(refusal.message).toContain('first-call');

    expect(tools.onWaitRequested).toHaveBeenCalledOnce();
  });

  it('does not consume the wait reservation for a not-found job', async () => {
    const tools = setup({ 'job://bash-3': undefined });

    await expect(
      waitTool.execute(tools.context, { jobs: ['job://bash-3'] }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'not_found',
      message: 'One or more jobs were not found in this Chat.',
    });
    expect(tools.beginWaitCall).not.toHaveBeenCalled();
  });

  it('returns not found without resolving a locator when the chat is unavailable', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
      undefined,
    );

    await expect(
      waitTool.execute(tools.context, { jobs: ['job://bash-3'] }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'not_found',
      message: 'One or more jobs were not found in this Chat.',
    });

    expect(tools.findByLocator).not.toHaveBeenCalled();
    expect(tools.beginWaitCall).not.toHaveBeenCalled();
  });

  it('does not suspend when the call has no durable wait context', async () => {
    const tools = setup({ 'job://bash-3': job('job-id') });
    const context = { ...tools.context, toolCallId: undefined };

    await expect(
      waitTool.execute(context, { jobs: ['job://bash-3'] }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'no_context',
      message: 'The wait could not be suspended safely.',
    });
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

    const readOutputTail = vi
      .spyOn(ChatJobsRepository.prototype, 'readOutputTail')
      .mockResolvedValue(Buffer.from('settled output'));

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
    expect(result).not.toHaveProperty('jobs.0.outputs');
    expect(readOutputTail).toHaveBeenCalledOnce();
  });

  it('omits empty exit details and reports cancellation and artifact locators', async () => {
    const startedAt = new Date('2026-11-14T12:00:00.000Z');

    const failed = {
      ...job('failed-id', 'failed'),
      result: null,
      startedAt,
      settledAt: startedAt,
      artifactId: 'artifact-id',
    };

    const cancelled = {
      ...job('cancelled-id', 'cancelled'),
      stoppedBy: 'owner' as const,
      result: { signal: 'SIGTERM' },
      startedAt,
      settledAt: startedAt,
    };

    vi.spyOn(ChatJobsRepository.prototype, 'readOutputTail').mockResolvedValue(
      Buffer.alloc(0),
    );

    const result = await buildWaitResult(
      TX,
      { chatId: 'chat-id', userId: 'owner-id' },
      [failed, cancelled],
      'interrupted',
    );

    expect(result).toMatchObject({
      ended: 'interrupted',
      jobs: [
        {
          locator: 'job://bash-3',
          state: 'failed',
          elapsedMs: 0,
          outputs: [],
          artifactLocator: 'artifact://bash-3',
        },
        {
          state: 'cancelled',
          exitDetail: { signal: 'SIGTERM', stoppedBy: 'owner' },
        },
      ],
    });
    expect(result).not.toHaveProperty('jobs.0.exitDetail');
    expect(result).not.toHaveProperty('promise');
  });

  it('returns only the final 2000 output characters', async () => {
    const startedAt = new Date('2026-11-14T12:00:00.000Z');

    const settled = {
      ...job('settled-id', 'succeeded'),
      startedAt,
      settledAt: startedAt,
      outputs: ['stdout'],
    };

    const readOutputTail = vi
      .spyOn(ChatJobsRepository.prototype, 'readOutputTail')
      .mockResolvedValue(Buffer.from('x'.repeat(2001)));

    const result = await buildWaitResult(
      TX,
      { chatId: 'chat-id', userId: 'owner-id' },
      [settled],
      'settled',
    );

    expect(result).toHaveProperty('jobs.0.outputs.0.text', 'x'.repeat(2000));
    expect(readOutputTail).toHaveBeenCalledOnce();
  });

  it('clamps negative duration and escapes reserved delimiters in output', async () => {
    const settled = {
      ...job('settled-id', 'succeeded'),
      startedAt: new Date('2026-11-14T12:00:01.000Z'),
      settledAt: new Date('2026-11-14T12:00:00.000Z'),
      result: { exitCode: null, signal: null, outcomeUnknown: false },
      outputs: ['stdout'],
    };

    vi.spyOn(ChatJobsRepository.prototype, 'readOutputTail').mockResolvedValue(
      Buffer.from('see </tool-result> here'),
    );

    const result = await buildWaitResult(
      TX,
      { chatId: 'chat-id', userId: 'owner-id' },
      [settled],
      'settled',
    );

    expect(result).toMatchObject({
      jobs: [
        {
          elapsedMs: 0,
          exitDetail: {
            exitCode: null,
            signal: null,
            outcomeUnknown: false,
          },
          outputs: [{ text: 'see &lt;/tool-result&gt; here' }],
        },
      ],
    });
  });
});
