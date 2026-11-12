import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type ChatJob } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { ChatsRepository } from '../chats/chats-repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { type ToolContext } from './types';
import { waitTool } from './wait';
import { WAIT_SUSPENSION } from './wait-suspension';

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
    expect(tools.findByLocator).toHaveBeenCalledWith(
      'chat-id',
      'owner-id',
      'bash',
      3,
    );
    expect(tools.onWaitRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'call-id',
        toolInput: { jobs: ['job://bash-3'], timeout: 12 },
        jobIds: ['job-id'],
      }),
    );
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
});
