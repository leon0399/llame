import type { Message } from '../db/schema';
import type { Db, TenantDbService } from '../db/tenant-db.service';
import type {
  CompactionService,
  CompactionSummary,
} from '../compaction/compaction.service';
import { MessagesRepository } from '../chats/messages-repository';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import { asDouble } from '../testing/support';
import type { ModelClient } from '../models/model-client';
import { CompactionRunService } from './compaction-run.service';
import type { RunExecutionService } from './run-execution.service';
import type { RunJob } from './run-queues';

const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'owner-1';
const job: RunJob = { runId: 'run-1', chatId, userId, modelId: 'model-1' };
const queueIdentity = { currentJobId: null, wakeGeneration: 0 };
const modelClient = asDouble<ModelClient>({});

const summary: CompactionSummary = {
  uptoSeq: 1,
  summary: 'A concise history.',
  usage: null,
};

function message(seq: number): Message {
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${seq.toString().padStart(12, '0')}`,
    chatId,
    seq,
    role: 'user',
    senderUserId: userId,
    parts: [{ type: 'text', text: `message ${seq}` }],
    attachments: [],
    usage: null,
    absorbedThroughSeq: null,
    inReplyTo: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    revisedAt: null,
  };
}

function makeService(
  options: {
    summary?: CompactionSummary | null;
    summarizeError?: Error;
  } = {},
) {
  const tx = asDouble<Db>({});

  const runAs = vi.fn<TenantDbService['runAs']>(async (_userId, callback) =>
    callback(tx),
  );

  const tenantDb = asDouble<TenantDbService>({ runAs });

  const summarizeCheckpoint = vi
    .fn<CompactionService['summarizeCheckpoint']>()
    .mockResolvedValue(
      options.summary === undefined ? summary : options.summary,
    );

  if (options.summarizeError) {
    summarizeCheckpoint.mockRejectedValue(options.summarizeError);
  }

  const completeCompactionRun = vi
    .fn<RunExecutionService['completeCompactionRun']>()
    .mockResolvedValue({ outcome: 'won' });

  const settleTerminalRun = vi
    .fn<RunExecutionService['settleTerminalRun']>()
    .mockResolvedValue({ outcome: 'won' });

  const claimRun = vi.fn<RunExecutionService['claimRun']>().mockResolvedValue({
    attemptId: 'attempt-1',
    messageId: null,
    permissionMode: 'default',
    nativeDeliverySequence: 0,
  });

  const service = new CompactionRunService(
    tenantDb,
    asDouble<Pick<CompactionService, 'summarizeCheckpoint'>>({
      summarizeCheckpoint,
    }),
    asDouble<InstanceConfigReader>({
      config: { runs: { maxOutputTokens: 4096 } },
    }),
    asDouble<
      Pick<
        RunExecutionService,
        'claimRun' | 'completeCompactionRun' | 'settleTerminalRun'
      >
    >({ claimRun, completeCompactionRun, settleTerminalRun }),
  );

  return {
    service,
    summarizeCheckpoint,
    completeCompactionRun,
    settleTerminalRun,
    claimRun,
  };
}

describe('CompactionRunService.execute', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not summarize when the Run claim was already settled', async () => {
    const made = makeService();
    made.claimRun.mockResolvedValue({ settledReply: undefined });

    await made.service.execute(
      job,
      modelClient,
      new AbortController().signal,
      queueIdentity,
    );

    expect(made.summarizeCheckpoint).not.toHaveBeenCalled();
    expect(made.completeCompactionRun).not.toHaveBeenCalled();
  });

  it('completes without a checkpoint summary when the Chat has no absorbable messages', async () => {
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue(
      [],
    );
    const made = makeService();

    await made.service.execute(
      job,
      modelClient,
      new AbortController().signal,
      queueIdentity,
    );

    expect(made.completeCompactionRun).toHaveBeenCalledWith(
      expect.objectContaining({ summary: undefined }),
    );
  });

  it('summarizes the planned prefix and completes with its checkpoint', async () => {
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);
    const made = makeService();

    made.claimRun.mockResolvedValue({
      attemptId: 'attempt-1',
      messageId: null,
      permissionMode: 'default',
      nativeDeliverySequence: 0,
      effort: 'high',
    });

    await made.service.execute(
      job,
      modelClient,
      new AbortController().signal,
      queueIdentity,
    );

    const request = made.summarizeCheckpoint.mock.calls[0]?.[0];
    expect(request?.variant).toBe('owner');
    expect(request?.chatId).toBe(chatId);
    expect(request?.userId).toBe(userId);
    expect(request?.triggeringUserSeq).toBe(2);
    expect(request?.plan.uptoSeq).toBe(1);
    expect(request?.reservedOutputTokens).toBe(4096);

    if (request?.variant === 'owner') {
      expect(request.effort).toBe('high');
    }

    expect(made.completeCompactionRun).toHaveBeenCalledWith(
      expect.objectContaining({ summary }),
    );
  });

  it('marks the Run failed when summary generation fails', async () => {
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);

    const made = makeService({
      summarizeError: new Error('provider unavailable'),
    });

    await made.service.execute(
      job,
      modelClient,
      new AbortController().signal,
      queueIdentity,
    );

    expect(made.settleTerminalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: job.runId,
        status: 'failed',
        error: { message: 'provider unavailable' },
        runPayload: { status: 'failed', message: 'provider unavailable' },
      }),
    );
    expect(made.completeCompactionRun).not.toHaveBeenCalled();
  });

  it('settles a missing summary as a terminal model failure', async () => {
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);
    const made = makeService({ summary: null });

    await made.service.execute(
      job,
      modelClient,
      new AbortController().signal,
      queueIdentity,
    );

    expect(made.settleTerminalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: {
          message: 'Compaction summary returned no valid text summary.',
        },
      }),
    );
  });

  it('rethrows cancellation without converting it into a failed Run', async () => {
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);
    const abort = new AbortController();
    abort.abort();
    const error = new Error('aborted');
    const made = makeService({ summarizeError: error });

    await expect(
      made.service.execute(job, modelClient, abort.signal, queueIdentity),
    ).rejects.toBe(error);
    expect(made.settleTerminalRun).not.toHaveBeenCalled();
  });
});
