import { BadRequestException, ConflictException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { NextCandidateUnavailableError } from '../models/models.service';
import { RunsRepository } from '../runs/runs-repository';
import { MessagesRepository } from './chats-repository';
import { continueNextDecision } from './follow-up-decisions';

const now = new Date('2026-11-23T13:00:00.000Z');
const tx: Db = drizzle.mock();

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

const userMessage: Message = {
  id: '11111111-1111-4111-8111-111111111111',
  chatId: '22222222-2222-4222-8222-222222222222',
  seq: 1,
  role: 'user',
  senderUserId: '33333333-3333-4333-8333-333333333333',
  parts: [{ type: 'text', text: 'retry' }],
  attachments: [],
  absorbedThroughSeq: null,
  usage: null,
  inReplyTo: null,
  createdAt: now,
  revisedAt: null,
};

const failedRun: Run = {
  id: '44444444-4444-4444-8444-444444444444',
  kind: 'turn',
  chatId: userMessage.chatId,
  messageId: userMessage.id,
  userId: userMessage.senderUserId ?? '',
  modelId: model.id,
  selector: '@coding',
  selectedEffort: null,
  selectionRevision: null,
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

const sourceReply: Message = {
  ...userMessage,
  id: '55555555-5555-4555-8555-555555555555',
  seq: 2,
  role: 'assistant',
  senderUserId: null,
  parts: [{ type: 'text', text: 'unfinished' }],
  usage: {
    status: 'error',
    runId: failedRun.id,
    modelId: model.id,
  },
  inReplyTo: userMessage.id,
};

const candidate = { modelId: 'next-model', model };
const resolveCandidate = vi.fn(() => candidate);

function makeDecision(run: Run, reply: Message | undefined) {
  vi.spyOn(RunsRepository.prototype, 'findLatestByChatId').mockResolvedValue(
    run,
  );
  vi.spyOn(MessagesRepository.prototype, 'findReply').mockResolvedValue(reply);

  return continueNextDecision(
    tx,
    { chatId: userMessage.chatId, userId: failedRun.userId },
    userMessage,
    resolveCandidate,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('continueNextDecision', () => {
  it('refuses a failed non-turn Run without resolving its candidate', async () => {
    const nextCandidate = vi.fn(() => candidate);

    vi.spyOn(RunsRepository.prototype, 'findLatestByChatId').mockResolvedValue({
      ...failedRun,
      kind: 'compaction',
    });

    const decision = await continueNextDecision(
      tx,
      { chatId: userMessage.chatId, userId: failedRun.userId },
      userMessage,
      nextCandidate,
    );

    expect(decision).toMatchObject({
      refusal: {
        message: 'A failed compaction Run cannot move to its next candidate',
      },
    });
    expect('refusal' in decision ? decision.refusal : undefined).toBeInstanceOf(
      NextCandidateUnavailableError,
    );
    expect(nextCandidate).not.toHaveBeenCalled();
  });

  it.each([
    ['no usage', null],
    [
      'usage from another Run',
      {
        status: 'error',
        runId: '66666666-6666-4666-8666-666666666666',
        modelId: model.id,
      },
    ],
    [
      'completed usage',
      { status: 'completed', runId: failedRun.id, modelId: model.id },
    ],
  ] as const)(
    'refuses a reply with %s before admitting a candidate',
    async (_label, usage) => {
      const reply: Message = {
        ...sourceReply,
        usage,
      };

      const result = await makeDecision(failedRun, reply);

      expect(result).toMatchObject({
        refusal: {
          message: 'The reply does not belong to a Run that can be continued',
        },
      });
      expect('refusal' in result ? result.refusal : undefined).toBeInstanceOf(
        NextCandidateUnavailableError,
      );
    },
  );

  it('returns a reply-less failed turn for a fresh candidate without kept parts', async () => {
    const result = await makeDecision(failedRun, undefined);

    expect(result).toEqual({
      latestRun: failedRun,
      next: candidate,
      keptParts: [],
    });
  });

  it('returns an HTTP refusal as a value and keeps a non-409 refusal unchanged', async () => {
    const refusal = new BadRequestException('request refused');
    vi.spyOn(RunsRepository.prototype, 'findLatestByChatId').mockRejectedValue(
      refusal,
    );

    const result = await continueNextDecision(
      tx,
      { chatId: userMessage.chatId, userId: failedRun.userId },
      userMessage,
      resolveCandidate,
    );

    expect(result).toEqual({ refusal });
  });

  it('turns a 409 refusal into a next-candidate refusal value', async () => {
    const refusal = new ConflictException('source reply is invalid');
    vi.spyOn(RunsRepository.prototype, 'findLatestByChatId').mockResolvedValue(
      failedRun,
    );
    vi.spyOn(MessagesRepository.prototype, 'findReply').mockRejectedValue(
      refusal,
    );

    const result = await continueNextDecision(
      tx,
      { chatId: userMessage.chatId, userId: failedRun.userId },
      userMessage,
      resolveCandidate,
    );

    expect(result).toEqual({
      refusal: new NextCandidateUnavailableError('source reply is invalid'),
    });
  });

  it('lets a repository failure escape instead of returning it as a refusal', async () => {
    const datastoreFailure = new Error('reply lookup failed');
    vi.spyOn(RunsRepository.prototype, 'findLatestByChatId').mockResolvedValue(
      failedRun,
    );
    vi.spyOn(MessagesRepository.prototype, 'findReply').mockRejectedValue(
      datastoreFailure,
    );

    await expect(
      continueNextDecision(
        tx,
        { chatId: userMessage.chatId, userId: failedRun.userId },
        userMessage,
        resolveCandidate,
      ),
    ).rejects.toBe(datastoreFailure);
  });
});
