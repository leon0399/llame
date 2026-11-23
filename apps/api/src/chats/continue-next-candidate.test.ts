import { type MockInstance } from 'vitest';

import { asDouble } from '../testing/support';

import { type Chat, type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type NextCandidate } from '../models/model-selection';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { type ContinueNextDecision } from './follow-up-decisions';
import { openContinueNextCandidate } from './continue-next-candidate';

const now = new Date('2026-11-23T13:00:00.000Z');

const tx: Db = asDouble<Db>({
  transaction: async <T>(callback: (inner: Db) => Promise<T>) => callback(tx),
});

const oldModel: SystemModelCatalogEntry = {
  id: 'old-model',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: 'old-model-provider-id',
  systemPromptTemplate: 'Bound prompt',
  systemPromptSource: 'model_override',
  referencesSkills: false,
};

const nextModel: SystemModelCatalogEntry = {
  ...oldModel,
  id: 'next-model',
  providerModelId: 'next-model-provider-id',
};

const chat: Chat = {
  id: '22222222-2222-4222-8222-222222222222',
  ownerUserId: '11111111-1111-4111-8111-111111111111',
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
  artifactSeq: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
  modelSelection: { revision: 7, selector: '@coding', effort: null },
};

const userMessage: Message = {
  id: '33333333-3333-4333-8333-333333333333',
  chatId: chat.id,
  seq: 1,
  role: 'user',
  senderUserId: chat.ownerUserId,
  parts: [{ type: 'text', text: 'try again' }],
  attachments: [],
  absorbedThroughSeq: null,
  usage: null,
  inReplyTo: null,
  createdAt: now,
  revisedAt: null,
};

const reply: Message = {
  ...userMessage,
  id: '44444444-4444-4444-8444-444444444444',
  seq: 2,
  role: 'assistant',
  senderUserId: null,
  parts: [{ type: 'reasoning', text: 'settled work' }],
  inReplyTo: userMessage.id,
};

const failedRun: Run = {
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'turn',
  origin: 'owner',
  chatId: chat.id,
  messageId: userMessage.id,
  userId: chat.ownerUserId,
  modelId: oldModel.id,
  selector: '@coding',
  selectedEffort: null,
  selectionRevision: 7,
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
  wakeGeneration: 0,
  currentJobId: null,
  awaiting: null,
  effort: null,
  permissionMode: 'default',
  followUpAction: null,
  sourceRunId: null,
};

const switchMessageId = '77777777-7777-4777-8777-777777777777';

const nextRun: Run = {
  ...failedRun,
  id: '66666666-6666-4666-8666-666666666666',
  messageId: switchMessageId,
  modelId: nextModel.id,
  status: 'queued',
  followUpAction: 'continue',
  sourceRunId: failedRun.id,
};

const switchMessage: Message = {
  ...userMessage,
  id: switchMessageId,
  seq: 3,
  parts: [],
};

const keptParts = [{ type: 'reasoning', text: 'settled work' }];

function decision(
  run: Run,
  source: Message | undefined,
): Extract<ContinueNextDecision, { latestRun: Run }> {
  const next: NextCandidate = { modelId: nextModel.id, model: nextModel };

  return {
    latestRun: run,
    ...(source !== undefined && { source }),
    next,
    keptParts: source === undefined ? [] : keptParts,
  };
}

let createRun: MockInstance<RunsRepository['create']>;
let createMessage: MockInstance<MessagesRepository['create']>;
let setSelection: MockInstance<ChatsRepository['setModelSelection']>;

/** The hold the switch stored on the Chat's selection, with its target. */
function expectHold(modelId: string, revertAt: string): void {
  expect(setSelection.mock.calls[0]?.slice(0, 2)).toEqual([
    chat.id,
    chat.ownerUserId,
  ]);
  expect(setSelection.mock.calls[0]?.[2]).toMatchObject({
    hold: { modelId, revertAt },
  });
}

beforeEach(() => {
  vi.spyOn(
    RunsRepository.prototype,
    'cancelActiveRunsForMessage',
  ).mockResolvedValue([]);
  createRun = vi
    .spyOn(RunsRepository.prototype, 'create')
    .mockResolvedValue(nextRun);
  createMessage = vi
    .spyOn(MessagesRepository.prototype, 'create')
    .mockResolvedValue(switchMessage);
  vi.spyOn(
    MessagesRepository.prototype,
    'updateAssistantReply',
  ).mockResolvedValue(reply);
  vi.spyOn(ChatsRepository.prototype, 'transactionNow').mockResolvedValue(now);
  setSelection = vi
    .spyOn(ChatsRepository.prototype, 'setModelSelection')
    .mockResolvedValue(undefined);
  vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
    (eventRunId, eventType, payload) =>
      Promise.resolve({
        sequence: 1,
        runId: eventRunId,
        eventType,
        payload,
        createdAt: now,
      }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openContinueNextCandidate', () => {
  it('cuts the stored reply and records its valid failure class and reset time', async () => {
    const run: Run = {
      ...failedRun,
      error: {
        code: 'quota_exhausted',
        resetsAt: Date.parse('2026-11-23T14:30:00.000Z'),
        hintMs: 60_000,
      },
    };

    const updateReply = vi.spyOn(
      MessagesRepository.prototype,
      'updateAssistantReply',
    );

    const appendEvent = vi.spyOn(RunEventsRepository.prototype, 'append');

    const result = await openContinueNextCandidate(tx, {
      request: { chatId: chat.id, userId: chat.ownerUserId },
      turn: { chat, userMessage },
      decision: decision(run, reply),
      permissionMode: 'default',
      config: { ...BUILT_IN_DEFAULTS, models: [nextModel, oldModel] },
    });

    expect(updateReply).toHaveBeenCalledWith({
      id: reply.id,
      chatId: chat.id,
      inReplyTo: userMessage.id,
      parts: keptParts,
    });
    expect(createMessage.mock.calls[0]?.[0]).toMatchObject({
      parts: [
        {
          data: {
            payload: {
              cause: 'failover',
              fromModelId: oldModel.id,
              toModelId: nextModel.id,
              failureClass: 'quota_exhausted',
            },
          },
        },
      ],
    });
    expect(JSON.stringify(createMessage.mock.calls[0]?.[0])).toContain(
      'old-model-provider-id',
    );
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: nextModel.id,
        followUpAction: 'continue',
        sourceRunId: run.id,
      }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      nextRun.id,
      'model.switched',
      expect.objectContaining({
        failureClass: 'quota_exhausted',
        toModelId: nextModel.id,
      }),
    );
    expectHold(nextModel.id, '2026-11-23T14:30:00.000Z');
    expect(result).toEqual({
      run: nextRun,
      message: switchMessage,
      modelId: nextModel.id,
    });
  });

  it('uses unknown failure and a five-minute hold for an invalid stored error', async () => {
    const run: Run = { ...failedRun, error: 'unstructured provider failure' };

    const updateReply = vi.spyOn(
      MessagesRepository.prototype,
      'updateAssistantReply',
    );

    const appendEvent = vi.spyOn(RunEventsRepository.prototype, 'append');

    await openContinueNextCandidate(tx, {
      request: { chatId: chat.id, userId: chat.ownerUserId },
      turn: { chat, userMessage },
      decision: decision(run, undefined),
      permissionMode: 'default',
      config: BUILT_IN_DEFAULTS,
    });

    expect(updateReply).not.toHaveBeenCalled();
    expect(createMessage.mock.calls[0]?.[0]).toMatchObject({
      parts: [
        {
          data: {
            payload: {
              cause: 'failover',
              fromModelId: oldModel.id,
              toModelId: nextModel.id,
              failureClass: 'unknown',
            },
          },
        },
      ],
    });
    expect(appendEvent).toHaveBeenCalledWith(
      nextRun.id,
      'model.switched',
      expect.objectContaining({
        failureClass: 'unknown',
        toModelId: nextModel.id,
      }),
    );
    expectHold(nextModel.id, '2026-11-23T13:05:00.000Z');
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({ followUpAction: 'continue' }),
    );
  });
  it('uses a finite retry hint when the stored reset time is invalid', async () => {
    const run: Run = {
      ...failedRun,
      error: {
        code: 'rate_limited',
        resetsAt: Number.POSITIVE_INFINITY,
        hintMs: 60_000,
      },
    };

    await openContinueNextCandidate(tx, {
      request: { chatId: chat.id, userId: chat.ownerUserId },
      turn: { chat, userMessage },
      decision: decision(run, undefined),
      permissionMode: 'default',
      config: BUILT_IN_DEFAULTS,
    });

    expectHold(nextModel.id, '2026-11-23T13:01:00.000Z');
  });

  it('records unknown for an unrecognized failure class in a stored error object', async () => {
    const run: Run = {
      ...failedRun,
      error: { code: 'provider-added-a-new-code' },
    };

    const appendEvent = vi.spyOn(RunEventsRepository.prototype, 'append');

    await openContinueNextCandidate(tx, {
      request: { chatId: chat.id, userId: chat.ownerUserId },
      turn: { chat, userMessage },
      decision: decision(run, undefined),
      permissionMode: 'default',
      config: BUILT_IN_DEFAULTS,
    });

    expect(createMessage.mock.calls[0]?.[0]).toMatchObject({
      parts: [{ data: { payload: { failureClass: 'unknown' } } }],
    });
    expect(appendEvent).toHaveBeenCalledWith(
      nextRun.id,
      'model.switched',
      expect.objectContaining({ failureClass: 'unknown' }),
    );
  });
});
