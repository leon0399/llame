/**
 * Follow-up admission (turn-actions D1–D4) at the service seam: every
 * repository is doubled, so each refusal and the admitted Run's event log are
 * observed without a database. The light integration suite covers the SQL and
 * the row locks; this file covers the branches that decide them.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { type Chat, type Message, type Run } from '../db/schema';
import {
  type Db,
  TenantDbService,
  type TenantRunner,
} from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import {
  ModelNotAvailableError,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { asDouble } from '../testing/support';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { continueKeptParts } from './continue-kept-parts';
import {
  FollowUpAdmissionService,
  type FollowUpRequestInput,
} from './follow-up-admission.service';

type Savepoint = {
  transaction: <T>(callback: (inner: Db) => Promise<T>) => Promise<T>;
};

const now = new Date('2026-10-27T00:00:00.000Z');

const model: SystemModelCatalogEntry = {
  id: 'system:openai:gpt-5.4-mini',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: 'gpt-5.4-mini',
  systemPromptTemplate: 'Bound prompt',
  systemPromptSource: 'model_override',
  referencesSkills: false,
};

const chat: Chat = {
  id: 'chat-id',
  ownerUserId: 'user-id',
  title: null,
  visibility: 'private',
  createdAt: now,
  updatedAt: now,
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
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
};

const userMessage: Message = {
  id: 'message-id',
  chatId: chat.id,
  seq: 1,
  role: 'user',
  senderUserId: chat.ownerUserId,
  parts: [{ type: 'text', text: 'do the work' }],
  attachments: [],
  absorbedThroughSeq: null,
  usage: null,
  inReplyTo: null,
  createdAt: now,
};

const sourceRun: Run = {
  id: 'run-source',
  chatId: chat.id,
  messageId: userMessage.id,
  userId: chat.ownerUserId,
  modelId: model.id,
  status: 'failed',
  workerId: null,
  activeAttemptId: null,
  completedAttemptId: null,
  turnToolAvailability: null,
  cancelRequestedAt: null,
  error: null,
  createdAt: now,
  startedAt: null,
  finishedAt: null,
  effort: null,
  permissionMode: 'default',
  followUpAction: null,
  sourceRunId: null,
};

/** The reply's parts: one settled step, then the unfinished one. */
const replyParts: Array<unknown> = [
  { type: 'reasoning', text: 'think' },
  {
    type: 'tool-read',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { path: '/tmp/file.txt' },
    output: { content: 'body' },
  },
  { type: 'text', text: 'unfinished' },
];

/** The reply usage shapes these tests build: a Run's own, or a completed one. */
type ReplyUsage = {
  status: 'error' | 'completed';
  runId: string;
  modelId: string;
};

function replyWith(usage: ReplyUsage | null): Message {
  return {
    id: 'reply-id',
    chatId: chat.id,
    seq: 2,
    role: 'assistant',
    senderUserId: null,
    parts: replyParts,
    attachments: [],
    absorbedThroughSeq: null,
    usage,
    inReplyTo: userMessage.id,
    createdAt: now,
  };
}

function fakeTx(): Db {
  const savepoint: Savepoint = {
    transaction: (callback) => callback(tx),
  };
  // The service only reaches the transaction for `createRunForMessage`'s
  // savepoint; every repository method is prototype-spied.
  const tx = asDouble<Db>(savepoint);
  return tx;
}

const validRequest: FollowUpRequestInput = { action: 'continue' };

function makeService() {
  const tx = fakeTx();
  const tenantDb: TenantRunner = new TenantDbService({
    transaction: async <T>(callback: (inner: Db) => Promise<T>) => callback(tx),
  });
  // Each admission closes with a record of whether its transaction callback
  // threw: a refusal that keeps a committed stuck-Run expiry must not.
  const transactions: Array<{ rejected: boolean }> = [];
  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (db: Db) => Promise<T>) => {
        const record = { rejected: false };
        transactions.push(record);
        try {
          return await callback(tx);
        } catch (error) {
          record.rejected = true;
          throw error;
        }
      },
    );

  const validateModelSelection = vi.fn(() => model);
  const resolveEffortSelection = vi.fn(() => undefined);
  const models: ModelSelectionValidator = {
    validateModelSelection,
    resolveEffortSelection,
  };
  const instanceConfig: InstanceConfigReader = { config: BUILT_IN_DEFAULTS };
  const jobState = vi.fn<RunDispatcher['jobState']>(() =>
    Promise.resolve('absent'),
  );
  const dispatch: RunDispatcher = { dispatch: vi.fn(async () => {}), jobState };

  const findById = vi
    .spyOn(ChatsRepository.prototype, 'findById')
    .mockResolvedValue(chat);
  const lock = vi
    .spyOn(ChatsRepository.prototype, 'lock')
    .mockResolvedValue(chat);
  const touch = vi
    .spyOn(ChatsRepository.prototype, 'touch')
    .mockResolvedValue(chat);
  const findTurnState = vi
    .spyOn(MessagesRepository.prototype, 'findTurnState')
    .mockResolvedValue({
      userMessage,
      assistantMessage: replyWith({
        status: 'error',
        runId: sourceRun.id,
        modelId: model.id,
      }),
    });
  const hasLaterUserMessage = vi
    .spyOn(MessagesRepository.prototype, 'hasLaterUserMessage')
    .mockResolvedValue(false);
  const findReply = vi
    .spyOn(MessagesRepository.prototype, 'findReply')
    .mockResolvedValue(
      replyWith({ status: 'error', runId: sourceRun.id, modelId: model.id }),
    );
  const findLatestByChatId = vi
    .spyOn(RunsRepository.prototype, 'findLatestByChatId')
    .mockResolvedValue(sourceRun);
  const findActiveByChatId = vi
    .spyOn(RunsRepository.prototype, 'findActiveByChatId')
    .mockResolvedValue(undefined);
  const markFinished = vi
    .spyOn(RunsRepository.prototype, 'markFinished')
    .mockResolvedValue(undefined);
  const listByRunId = vi
    .spyOn(RunEventsRepository.prototype, 'listByRunId')
    .mockResolvedValue([]);
  const cancelActiveRunsForMessage = vi
    .spyOn(RunsRepository.prototype, 'cancelActiveRunsForMessage')
    .mockResolvedValue([]);
  const createRun = vi
    .spyOn(RunsRepository.prototype, 'create')
    .mockImplementation((runInput) =>
      Promise.resolve({
        ...sourceRun,
        id: runInput.id ?? 'run-created',
        status: 'queued',
        effort: runInput.effort ?? null,
        permissionMode: runInput.permissionMode ?? 'default',
        followUpAction: runInput.followUpAction ?? null,
        sourceRunId: runInput.sourceRunId ?? null,
      }),
    );
  const append = vi
    .spyOn(RunEventsRepository.prototype, 'append')
    .mockResolvedValue({
      sequence: 1,
      runId: sourceRun.id,
      eventType: 'run.created',
      payload: null,
      createdAt: now,
    });

  const service = new FollowUpAdmissionService(
    tenantDb,
    models,
    instanceConfig,
    dispatch,
  );

  return {
    service,
    runAs,
    transactions,
    findById,
    lock,
    touch,
    findTurnState,
    hasLaterUserMessage,
    findReply,
    findLatestByChatId,
    findActiveByChatId,
    markFinished,
    listByRunId,
    cancelActiveRunsForMessage,
    createRun,
    append,
    jobState,
    validateModelSelection,
  };
}

function admit(
  service: FollowUpAdmissionService,
  request: FollowUpRequestInput = validRequest,
) {
  return service.admitFollowUpRun({
    chatId: chat.id,
    userId: chat.ownerUserId,
    userMessageId: userMessage.id,
    request,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FollowUpAdmissionService', () => {
  it('admits a Continue and records the Run its event log continues', async () => {
    const { service, runAs, createRun, append, touch } = makeService();

    const admitted = await admit(service);

    expect(runAs).toHaveBeenCalledWith(chat.ownerUserId, expect.anything());
    // The accepted turn is the Chat's latest activity again.
    expect(touch).toHaveBeenCalledWith(chat.id, chat.ownerUserId);
    expect(admitted).toMatchObject({
      chatId: chat.id,
      userId: chat.ownerUserId,
      modelId: model.id,
      supersededRunIds: [],
      userMessage: { id: userMessage.id, seq: userMessage.seq },
    });
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: chat.id,
        messageId: userMessage.id,
        userId: chat.ownerUserId,
        modelId: model.id,
        effort: undefined,
        permissionMode: 'default',
        followUpAction: 'continue',
        sourceRunId: sourceRun.id,
      }),
    );
    expect(append).toHaveBeenNthCalledWith(1, admitted.runId, 'run.created', {
      chatId: chat.id,
      messageId: userMessage.id,
      replacesUsage: true,
    });
    expect(append).toHaveBeenNthCalledWith(2, admitted.runId, 'run.continued', {
      sourceRunId: sourceRun.id,
      parts: continueKeptParts(replyParts),
    });
  });

  it('rejects an action other than continue before any transaction', async () => {
    const { service, runAs } = makeService();

    await expect(
      admit(service, { action: 'regenerate' }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'action must be continue',
    });
    expect(runAs).not.toHaveBeenCalled();
  });

  it('rejects a model or an effort named on a Continue', async () => {
    const { service, runAs } = makeService();

    await expect(
      admit(service, { action: 'continue', modelId: model.id }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'A continue request does not name a model',
    });
    await expect(
      admit(service, { action: 'continue', effort: 'high' }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'A continue request does not name an effort',
    });
    expect(runAs).not.toHaveBeenCalled();
  });

  it('rejects a permission mode the operator did not enable', async () => {
    const { service } = makeService();

    await expect(
      admit(service, { action: 'continue', permissionMode: 'bypass' }),
    ).rejects.toThrow('bypass');
  });

  it('answers 404 for an unowned Chat before taking its row lock', async () => {
    const { service, findById, lock, touch } = makeService();
    findById.mockResolvedValue(undefined);

    await expect(admit(service)).rejects.toMatchObject({
      constructor: NotFoundException,
      message: `Chat ${chat.id} not found`,
    });
    expect(lock).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it('answers 404 when the row lock finds no owned Chat', async () => {
    const { service, lock, touch } = makeService();
    lock.mockResolvedValue(undefined);

    await expect(admit(service)).rejects.toMatchObject({
      constructor: NotFoundException,
      message: `Chat ${chat.id} not found`,
    });
    expect(touch).not.toHaveBeenCalled();
  });

  it('leaves the Chat’s recency alone when the Continue check refuses', async () => {
    const { service, findLatestByChatId, touch } = makeService();
    findLatestByChatId.mockResolvedValue({ ...sourceRun, status: 'completed' });

    await expect(admit(service)).rejects.toBeInstanceOf(ConflictException);

    // A refused request writes nothing: the row lock took no column with it.
    expect(touch).not.toHaveBeenCalled();
  });

  it('answers 404 for a message that is not the Chat’s turn', async () => {
    const { service, findTurnState } = makeService();
    findTurnState.mockResolvedValue({ userMessage: undefined });

    await expect(admit(service)).rejects.toMatchObject({
      constructor: NotFoundException,
      message: `Message ${userMessage.id} not found`,
    });
  });

  it('refuses a follow-up on a turn that is not the latest one', async () => {
    const { service, hasLaterUserMessage, findLatestByChatId } = makeService();
    hasLaterUserMessage.mockResolvedValue(true);

    await expect(admit(service)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'A follow-up request applies to the latest user message only',
    });
    // The turn check runs before any Run state is read.
    expect(findLatestByChatId).not.toHaveBeenCalled();
  });

  it('refuses a message with no Run of its own', async () => {
    const { service, findLatestByChatId } = makeService();
    findLatestByChatId.mockResolvedValue(undefined);

    await expect(admit(service)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'The message has no Run to follow up',
    });
  });

  it('refuses a Continue when the latest Run belongs to another message', async () => {
    const { service, findLatestByChatId } = makeService();
    findLatestByChatId.mockResolvedValue({
      ...sourceRun,
      messageId: 'another-message',
    });

    await expect(admit(service)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'The message has no Run to follow up',
    });
  });

  it('refuses a Continue on a Run that is not resumable', async () => {
    const { service, findLatestByChatId } = makeService();
    findLatestByChatId.mockResolvedValue({ ...sourceRun, status: 'completed' });

    await expect(admit(service)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'A completed Run cannot be continued',
    });
  });

  it('refuses a Continue when the Run left no reply', async () => {
    const { service, findReply } = makeService();
    findReply.mockResolvedValue(undefined);

    await expect(admit(service)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'The Run that can be continued left no reply',
    });
  });

  const invalidUsage: Array<[string, ReplyUsage | null]> = [
    ['no usage', null],
    [
      'another Run’s usage',
      { status: 'error', runId: 'another-run', modelId: model.id },
    ],
    [
      'completed usage',
      { status: 'completed', runId: sourceRun.id, modelId: model.id },
    ],
  ];

  it.each(invalidUsage)(
    'refuses a reply whose usage is %s',
    async (_label, usage) => {
      const { service, findReply } = makeService();
      findReply.mockResolvedValue(replyWith(usage));

      await expect(admit(service)).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'The reply does not belong to a Run that can be continued',
      });
    },
  );

  describe('a stuck-Run expiry and a refusal in one transaction', () => {
    /** A non-terminal Run the queue can no longer execute. */
    const stuckRun: Run = {
      ...sourceRun,
      id: 'run-stuck',
      status: 'queued',
      createdAt: new Date(now.getTime() - 60_000),
    };

    /** The Run that expiry writes, as the expiry reports it. */
    const expiredRun: Run = {
      ...stuckRun,
      status: 'expired',
      finishedAt: now,
    };

    function stuckAdmission() {
      const api = makeService();
      api.findActiveByChatId.mockResolvedValue(stuckRun);
      api.jobState.mockResolvedValue('absent');
      api.markFinished.mockResolvedValue(expiredRun);
      // The Continue check refuses: the expired Run left no reply.
      api.findLatestByChatId.mockResolvedValue(expiredRun);
      api.findReply.mockResolvedValue(undefined);
      return api;
    }

    it('keeps the expiry when the Continue check then refuses', async () => {
      const api = stuckAdmission();

      await expect(admit(api.service)).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'The Run that can be continued left no reply',
      });

      expect(api.markFinished).toHaveBeenCalledWith(
        stuckRun.id,
        chat.ownerUserId,
        'expired',
        expect.anything(),
      );
      expect(api.append).toHaveBeenCalledWith(
        stuckRun.id,
        'run.expired',
        expect.anything(),
      );
      // The refusal is answered after the commit: the callback never threw, so
      // the expiry, its reply finalization, and run.expired survived.
      expect(api.transactions).toEqual([{ rejected: false }]);
    });

    it('rolls the expiry back when execution — not the request — fails', async () => {
      const api = stuckAdmission();
      const failure = new Error('reply read failed');
      api.findReply.mockRejectedValue(failure);

      await expect(admit(api.service)).rejects.toBe(failure);

      expect(api.transactions).toEqual([{ rejected: true }]);
    });

    it('keeps the expiry when the model check refuses', async () => {
      const api = stuckAdmission();
      api.findReply.mockResolvedValue(
        replyWith({ status: 'error', runId: expiredRun.id, modelId: model.id }),
      );
      api.validateModelSelection.mockImplementation(() => {
        throw new ModelNotAvailableError(model.id);
      });

      await expect(admit(api.service)).rejects.toBeInstanceOf(
        ModelNotAvailableError,
      );

      expect(api.transactions).toEqual([{ rejected: false }]);
    });
  });

  it('re-resolves the stored effort through the model validator', async () => {
    const { service, findLatestByChatId, validateModelSelection } =
      makeService();
    findLatestByChatId.mockResolvedValue({ ...sourceRun, effort: 'high' });

    await admit(service);

    expect(validateModelSelection).toHaveBeenCalledWith(model.id);
  });
});
