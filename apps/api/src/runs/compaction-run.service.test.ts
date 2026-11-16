import { drizzle } from 'drizzle-orm/postgres-js';

import type { Message } from '../db/schema';
import { MessagesRepository } from '../chats/messages-repository';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type CompactionCapability } from '../compaction/compaction.service';
import { createFakeModelClient } from '../models/fake-model-client';
import { asDouble } from '../testing/support';
import { CompactionRunService } from './compaction-run.service';
import { RunExecutionService } from './run-execution.service';

const job = {
  runId: 'run-compact',
  chatId: 'chat-1',
  userId: 'owner-1',
  modelId: 'composer-model',
};

function makeMessage(seq: number, role: Message['role']): Message {
  return asDouble<Message>({
    id: `message-${seq}`,
    chatId: job.chatId,
    seq,
    role,
    senderUserId: role === 'user' ? job.userId : null,
    parts: [{ type: 'text', text: `history ${seq}` }],
    attachments: [],
    usage: null,
    absorbedThroughSeq: null,
    inReplyTo: null,
  });
}

function makeService(options?: {
  summarize?: CompactionCapability['summarizeCheckpoint'];
}) {
  const db: Db = drizzle.mock();

  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });

  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  );

  vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
    makeMessage(1, 'user'),
    makeMessage(2, 'assistant'),
  ]);

  vi.spyOn(
    MessagesRepository.prototype,
    'findActiveCheckpoint',
  ).mockResolvedValue(undefined);

  const summarizeCheckpoint = vi.fn(
    options?.summarize ?? (() => Promise.resolve(undefined)),
  );

  const completeCompactionRun = vi.fn().mockResolvedValue(undefined);
  const settleTerminalRun = vi.fn().mockResolvedValue(undefined);

  const execution = asDouble<
    Pick<
      RunExecutionService,
      'claimRun' | 'completeCompactionRun' | 'settleTerminalRun'
    >
  >({
    claimRun: vi.fn().mockResolvedValue({
      attemptId: 'attempt-1',
      effort: 'low',
      permissionMode: 'default',
      messageId: null,
      nativeDeliverySequence: 0,
    }),
    completeCompactionRun,
    settleTerminalRun,
  });

  const client = createFakeModelClient(['summary']);

  Object.assign(client, {
    model: job.modelId,
  });

  const instanceConfig = asDouble<InstanceConfigReader>({
    config: {
      ...BUILT_IN_DEFAULTS,
      runs: { ...BUILT_IN_DEFAULTS.runs, maxOutputTokens: 1024 },
    },
  });

  const service = new CompactionRunService(
    tenantDb,
    asDouble<CompactionCapability>({ summarizeCheckpoint }),
    instanceConfig,
    execution,
  );

  return {
    service,
    client,
    summarizeCheckpoint,
    completeCompactionRun,
    settleTerminalRun,
  };
}

describe('CompactionRunService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Compact with the composer model', async () => {
    const setup = makeService();

    await setup.service.execute(
      job,
      setup.client,
      new AbortController().signal,
    );

    expect(setup.summarizeCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'owner',
        client: setup.client,
        effort: 'low',
      }),
    );
  });

  it('Delegates fit selection to CompactionService', async () => {
    const setup = makeService();

    await setup.service.execute(
      job,
      setup.client,
      new AbortController().signal,
    );

    expect(setup.summarizeCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'owner',
        client: setup.client,
      }),
    );
  });

  it('A provider error during a compaction Run', async () => {
    const setup = makeService({
      summarize: () => Promise.reject(new Error('provider failed')),
    });

    await setup.service.execute(
      job,
      setup.client,
      new AbortController().signal,
    );

    expect(setup.settleTerminalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: { message: 'provider failed' },
      }),
    );
    expect(setup.completeCompactionRun).not.toHaveBeenCalled();
  });
});
