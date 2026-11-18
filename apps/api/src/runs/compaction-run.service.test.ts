import {
  RUN_TIMEOUT_ABORT_REASON,
  type RunExecutionService,
} from './run-execution.service';
import type { Db, TenantDbService } from '../db/tenant-db.service';
import type {
  CompactionService,
  CompactionSummary,
} from '../compaction/compaction.service';
import { MessagesRepository } from '../chats/messages-repository';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import { asDouble } from '../testing/support';
import type { ModelClient } from '../models/model-client';
import { RunEventsRepository } from './runs-repository';
import { CompactionRunService } from './compaction-run.service';
import type { RunJob } from './run-queues';

import type { Message } from '../db/schema/chats';

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
    focus?: string | null;
  } = {},
) {
  const tx = asDouble<Db>({});

  const runAs = vi.fn<TenantDbService['runAs']>(async (_userId, callback) =>
    callback(tx),
  );

  const tenantDb = asDouble<TenantDbService>({ runAs });
  vi.spyOn(RunEventsRepository.prototype, 'findFirstByType').mockResolvedValue(
    asDouble({
      payload: { compaction: { focus: options.focus ?? null } },
    }),
  );

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
    expect(request).toMatchObject({
      variant: 'owner',
      chatId,
      userId,
      triggeringUserSeq: 2,
      plan: { uptoSeq: 1 },
      reservedOutputTokens: 4096,
    });
    expect(made.completeCompactionRun).toHaveBeenCalledWith(
      expect.objectContaining({ summary }),
    );
  });

  it('passes the admitted focus to the summary request and checkpoint', async () => {
    const focus = 'keep the migration plan';
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);
    const made = makeService({ focus });

    await made.service.execute(
      job,
      modelClient,
      new AbortController().signal,
      queueIdentity,
    );

    const request = made.summarizeCheckpoint.mock.calls[0]?.[0];
    expect(request?.variant).toBe('owner');

    if (request?.variant === 'owner') {
      expect(request.instruction).toContain(focus);
    }

    expect(made.completeCompactionRun).toHaveBeenCalledWith(
      expect.objectContaining({ focus }),
    );
  });

  it('omits absent effort from the owner summary request', async () => {
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);
    const made = makeService();

    await made.service.execute(
      job,
      modelClient,
      new AbortController().signal,
      queueIdentity,
    );

    expect(made.summarizeCheckpoint.mock.calls[0]?.[0]).not.toHaveProperty(
      'effort',
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
        error: { message: 'provider unavailable', code: 'unknown' },
        runPayload: {
          status: 'failed',
          message: 'provider unavailable',
          code: 'unknown',
        },
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
          code: 'unknown',
        },
      }),
    );
  });

  it('settles cancellation with the claimed attempt and queue fences', async () => {
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);
    const abort = new AbortController();
    const error = new Error('aborted');
    const made = makeService({ summarizeError: error });

    abort.abort();

    await made.service.execute(job, modelClient, abort.signal, queueIdentity);

    expect(made.settleTerminalRun).toHaveBeenCalledWith({
      runId: job.runId,
      userId,
      status: 'cancelled',
      attemptId: 'attempt-1',
      expectedQueueIdentity: queueIdentity,
      runPayload: { status: 'cancelled', message: 'Run was cancelled.' },
      error: { message: 'Run was cancelled.' },
    });
    expect(made.completeCompactionRun).not.toHaveBeenCalled();
  });

  it('settles a summary timeout with the exact expiry message and fences', async () => {
    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);
    const abort = new AbortController();
    const made = makeService({ summarizeError: new Error('aborted') });
    abort.abort(RUN_TIMEOUT_ABORT_REASON);

    await made.service.execute(job, modelClient, abort.signal, queueIdentity);

    expect(made.settleTerminalRun).toHaveBeenCalledWith({
      runId: job.runId,
      userId,
      status: 'expired',
      attemptId: 'attempt-1',
      expectedQueueIdentity: queueIdentity,
      runPayload: {
        status: 'expired',
        message: 'Run timed out: exceeded its wall-clock budget.',
      },
      error: { message: 'Run timed out: exceeded its wall-clock budget.' },
    });
    expect(made.completeCompactionRun).not.toHaveBeenCalled();
  });

  it.each(['plan', 'completeCompactionRun'] as const)(
    'rethrows a non-abort failure from %s without terminal settlement',
    async (failureAt) => {
      const error = new Error(`${failureAt} failed`);
      const made = makeService();

      if (failureAt === 'plan') {
        vi.spyOn(
          MessagesRepository.prototype,
          'findActiveCheckpoint',
        ).mockRejectedValue(error);
      } else {
        vi.spyOn(
          MessagesRepository.prototype,
          'findActiveCheckpoint',
        ).mockResolvedValue(undefined);
        vi.spyOn(
          MessagesRepository.prototype,
          'findByChatId',
        ).mockResolvedValue([]);
        made.completeCompactionRun.mockRejectedValue(error);
      }

      await expect(
        made.service.execute(
          job,
          modelClient,
          new AbortController().signal,
          queueIdentity,
        ),
      ).rejects.toBe(error);
      expect(made.settleTerminalRun).not.toHaveBeenCalled();
    },
  );
});
