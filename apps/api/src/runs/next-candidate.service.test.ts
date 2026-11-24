import { isString } from '@workspace/runtime-safety';
import type { Chat, ChatDelivery, Message, Run } from '../db/schema';
import type { Db } from '../db/tenant-db.service';

import { TenantDbService } from '../db/tenant-db.service';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import { asDouble } from '../testing/support';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import type { RunDispatchService } from './run-dispatch.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { NextCandidateService } from './next-candidate.service';
import {
  effortAfterSwitch,
  type NextCandidate,
} from '../models/model-selection';

const SONNET: NextCandidate['model'] = {
  id: 'system:anthropic:sonnet',
  source: 'system',
  provider: 'anthropic',
  providerModelId: 'claude-sonnet',
  contextWindowTokens: 200_000,
  input: ['text'],
  systemPromptTemplate: 'prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
  reasoning: {
    effortLevels: [{ value: 'low' }, { value: 'medium' }],
    defaultEffort: 'low',
    cacheInvalidatedByEffortChange: false,
  },
};

const OPENAI: NextCandidate['model'] = {
  ...SONNET,
  id: 'system:openai:gpt-5.4-mini',
  provider: 'openai',
  providerModelId: 'openai-catalog-provider-id',
};

const now = new Date('2026-11-23T13:00:00.000Z');
const runId = '11111111-1111-4111-8111-111111111111';
const chatId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const userId = 'user-1';

const userMessage: Message = {
  id: messageId,
  chatId,
  seq: 1,
  role: 'user',
  senderUserId: userId,
  parts: [{ type: 'text', text: 'hello' }],
  attachments: [],
  usage: null,
  absorbedThroughSeq: null,
  inReplyTo: null,
  createdAt: now,
  revisedAt: null,
};

const deliveredMessage: Message = {
  ...userMessage,
  id: '44444444-4444-4444-8444-444444444444',
  seq: 3,
  senderUserId: null,
};

const chat: Chat = {
  id: chatId,
  ownerUserId: userId,
  title: null,
  visibility: 'private',
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  modelSelection: {
    revision: 7,
    selector: '@coding',
    effort: 'high',
  },
  projectId: null,
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
};

const parkedRun: Run = {
  id: runId,
  kind: 'turn',
  chatId,
  origin: 'owner',
  messageId,
  userId,
  modelId: 'system:openai:gpt-5.4-mini',
  selector: '@coding',
  selectedEffort: 'xhigh',
  selectionRevision: 7,
  activeAttemptId: null,
  completedAttemptId: null,
  turnToolAvailability: null,
  status: 'awaiting_quota',
  workerId: null,
  cancelRequestedAt: null,
  error: { code: 'rate_limited', hintMs: 120_000 },
  createdAt: now,
  startedAt: now,
  finishedAt: null,
  wakeGeneration: 4,
  currentJobId: 'wait-job',
  awaiting: {
    kind: 'quota',
    failureClass: 'rate_limited',
    resetsAt: '',
    wakeAt: '2026-11-23T13:02:00.000Z',
    resumeAt: 'request',
    waitCount: 1,
  },
  effort: null,
  permissionMode: 'default',
  followUpAction: null,
  sourceRunId: null,
};

const movedRun: Run = {
  ...parkedRun,
  status: 'queued',
  modelId: SONNET.id,
  effort: 'medium',
  messageId: deliveredMessage.id,
  currentJobId: 'next-job',
};

function pendingDelivery(id: string, text: string): ChatDelivery {
  return {
    id,
    chatId,
    ownerUserId: userId,
    producer: 'owner',
    senderRef: null,
    mode: 'steer',
    parts: [{ type: 'text', text }],
    settings: { selector: '@coding', permissionMode: 'default' },
    state: 'pending',
    position: 1,
    deliveredMessageId: null,
    runId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeService(
  input: {
    moved?: Run;
    parked?: Run;
    pending?: Array<ChatDelivery>;
  } = {},
) {
  const parked = input.parked ?? parkedRun;
  const moved = Object.hasOwn(input, 'moved') ? input.moved : movedRun;
  const lockResult = Promise.resolve([parked]);

  const lockQuery = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(() => lockResult),
  };

  lockQuery.from.mockReturnValue(lockQuery);
  lockQuery.where.mockReturnValue(lockQuery);

  const updateQuery = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn().mockResolvedValue([{ id: parked.id }]),
  };

  updateQuery.set.mockReturnValue(updateQuery);
  updateQuery.where.mockReturnValue(updateQuery);

  const tx = asDouble<Db>({
    select: vi.fn(() => lockQuery),
    update: vi.fn(() => updateQuery),
  });

  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (inner: Db) => Promise<T>) => callback(tx),
  });

  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_id: string, callback: (inner: Db) => Promise<T>) => callback(tx),
  );
  vi.spyOn(RunsRepository.prototype, 'findById')
    .mockResolvedValueOnce(parked)
    .mockResolvedValue(moved);
  vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(chat);
  vi.spyOn(ChatsRepository.prototype, 'transactionNow').mockResolvedValue(now);

  const setModelSelection = vi
    .spyOn(ChatsRepository.prototype, 'setModelSelection')
    .mockResolvedValue(undefined);

  vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
    userMessage,
    assistantMessage: undefined,
  });

  const createMessage = vi
    .spyOn(MessagesRepository.prototype, 'create')
    .mockResolvedValue(deliveredMessage);

  const createUserMessage = vi
    .spyOn(MessagesRepository.prototype, 'createUserMessageIfAbsent')
    .mockResolvedValue(deliveredMessage);

  vi.spyOn(MessagesRepository.prototype, 'findById').mockResolvedValue(
    userMessage,
  );

  const markDelivered = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'markDelivered')
    .mockImplementation((id) =>
      Promise.resolve(input.pending?.find((item) => item.id === id)),
    );

  vi.spyOn(
    ChatDeliveriesRepository.prototype,
    'lockPendingBoundary',
  ).mockResolvedValue(input.pending ?? []);
  vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([]);
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

  const enqueueInTransaction = vi.fn<
    RunDispatchService['enqueueInTransaction']
  >(async () => {});

  const service = new NextCandidateService(
    tenantDb,
    {
      nextCandidate: () => ({
        modelId: SONNET.id,
        model: SONNET,
        candidateEffort: 'medium',
      }),
    },
    asDouble<InstanceConfigReader>({
      config: { models: [SONNET, OPENAI] },
    }),
    { enqueueInTransaction },
  );

  return {
    service,
    setModelSelection,
    updateQuery,
    enqueueInTransaction,
    createMessage,
    createUserMessage,
    markDelivered,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the next candidate effort', () => {
  it('uses the role candidate effort when the selected effort is unsupported', () => {
    expect(
      effortAfterSwitch({
        selectedEffort: 'xhigh',
        model: SONNET,
        candidateEffort: 'medium',
      }),
    ).toEqual({ kind: 'effort', effort: 'medium' });
  });
});

describe('moving a quota-waiting Run to its next candidate', () => {
  it('holds the candidate until the stored provider retry hint expires', async () => {
    const api = makeService();

    const outcome = await api.service.moveWaitingRun({
      runId: parkedRun.id,
      userId,
    });

    expect(outcome.kind).toBe('moved');
    expect(api.setModelSelection).toHaveBeenCalledWith(
      chat.id,
      userId,
      expect.objectContaining({
        hold: {
          selector: '@coding',
          modelId: SONNET.id,
          effort: 'medium',
          revertAt: '2026-11-23T13:02:00.000Z',
        },
      }),
    );
    expect(api.enqueueInTransaction).toHaveBeenCalled();
    expect(api.enqueueInTransaction.mock.calls[0]?.[1]).toMatchObject({
      modelId: SONNET.id,
    });
    expect(isString(api.enqueueInTransaction.mock.calls[0]?.[2]?.id)).toBe(
      true,
    );
    expect(JSON.stringify(api.createMessage.mock.calls[0]?.[0])).toContain(
      'openai-catalog-provider-id',
    );
  });

  it('leaves a quota-waiting compact command pending instead of delivering it', async () => {
    const ordinary = pendingDelivery(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'continue with the requested change',
    );

    const compact = pendingDelivery(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '/compact keep the plan',
    );

    const api = makeService({ pending: [ordinary, compact] });

    await api.service.moveWaitingRun({ runId, userId });

    const deliveredParts = api.createUserMessage.mock.calls[0]?.[0].parts;

    expect(deliveredParts?.[0]).toMatchObject({
      data: { payload: { cause: 'failover' } },
    });
    expect(deliveredParts).toContainEqual({
      type: 'text',
      text: 'continue with the requested change',
    });
    expect(deliveredParts).not.toContainEqual({
      type: 'text',
      text: '/compact keep the plan',
    });
    expect(api.markDelivered).toHaveBeenCalledTimes(1);
    expect(api.markDelivered).toHaveBeenCalledWith(
      ordinary.id,
      userId,
      expect.anything(),
    );
    expect(api.markDelivered).not.toHaveBeenCalledWith(
      compact.id,
      userId,
      expect.anything(),
    );
  });

  it('refuses a Run that is no longer waiting for quota', async () => {
    const api = makeService({
      parked: { ...parkedRun, status: 'queued' },
    });

    await expect(
      api.service.moveWaitingRun({ runId, userId }),
    ).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(api.setModelSelection).not.toHaveBeenCalled();
    expect(api.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it('refuses a quota-waiting compaction Run', async () => {
    const api = makeService({
      parked: { ...parkedRun, kind: 'compaction' },
    });

    await expect(
      api.service.moveWaitingRun({ runId, userId }),
    ).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(api.setModelSelection).not.toHaveBeenCalled();
    expect(api.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it('reports a run that disappears after the fenced move', async () => {
    const api = makeService({ moved: undefined });

    await expect(
      api.service.moveWaitingRun({ runId: parkedRun.id, userId }),
    ).rejects.toThrow(`Run ${parkedRun.id} vanished after its switch.`);
  });
});
