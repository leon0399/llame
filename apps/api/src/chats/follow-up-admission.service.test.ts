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
import { type ModelSelectionValidator } from '../models/models.service';
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
  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (db: Db) => Promise<T>) =>
        callback(tx),
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
    findById,
    touch,
    findTurnState,
    hasLaterUserMessage,
    findReply,
    findLatestByChatId,
    findActiveByChatId,
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
    const { service, runAs, createRun, append } = makeService();

    const admitted = await admit(service);

    expect(runAs).toHaveBeenCalledWith(chat.ownerUserId, expect.anything());
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
    const { service, findById, touch } = makeService();
    findById.mockResolvedValue(undefined);

    await expect(admit(service)).rejects.toMatchObject({
      constructor: NotFoundException,
      message: `Chat ${chat.id} not found`,
    });
    expect(touch).not.toHaveBeenCalled();
  });

  it('answers 404 when the row lock finds no owned Chat', async () => {
    const { service, touch } = makeService();
    touch.mockResolvedValue(undefined);

    await expect(admit(service)).rejects.toMatchObject({
      constructor: NotFoundException,
      message: `Chat ${chat.id} not found`,
    });
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

  it('re-resolves the stored effort through the model validator', async () => {
    const { service, findLatestByChatId, validateModelSelection } =
      makeService();
    findLatestByChatId.mockResolvedValue({ ...sourceRun, effort: 'high' });

    await admit(service);

    expect(validateModelSelection).toHaveBeenCalledWith(model.id);
  });
});
