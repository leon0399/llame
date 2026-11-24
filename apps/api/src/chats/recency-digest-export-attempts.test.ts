import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashWithDomain } from '../canonical-json';
import type {
  Chat,
  Message,
  RecencyDigestBaseline,
  Run,
  RunEvent,
  SystemPromptReceipt,
} from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import {
  DEFAULT_CHAT_SYSTEM_PROMPT_PATH,
  renderSystemPromptTemplate,
} from '../instance-config/prompt-loader';
import {
  DEFAULT_PROMPT_FILE_ACCESS,
  readPromptSource,
} from '../prompts/template-engine';
import {
  formatTemporalAnchor,
  resolveInstanceTimezone,
} from '../prompts/temporal-anchor';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { SystemPromptReceiptsRepository } from '../runs/system-prompt-receipts.repository';
import { MessagesRepository } from './messages-repository';
import { reconstructDigestAttempts } from './recency-digest-export-attempts';
import { SYSTEM_PROMPT_RECEIPT_DOMAIN } from './recency-digest-export-proof';

const OWNER = 'owner-1';
const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const TRIGGER_ID = '22222222-2222-4222-8222-222222222222';
const LATER_TRIGGER_ID = '22222222-2222-4222-8222-222222222223';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const DATE = new Date('2026-11-23T12:00:00.000Z');

const baseline: RecencyDigestBaseline = {
  pinned: [],
  recent: [
    {
      title: 'Private title',
      date: '2026-11-22',
      messageCount: 3,
      excerpt: 'Private excerpt',
    },
  ],
  pinnedShown: 0,
  pinnedTotal: 0,
  recentShown: 1,
  recentTotal: 1,
  compiledOn: '2026-11-23',
};

const packagedTemplate = readPromptSource(
  DEFAULT_CHAT_SYSTEM_PROMPT_PATH,
  DEFAULT_PROMPT_FILE_ACCESS,
);

const chat: Chat = {
  id: CHAT_ID,
  ownerUserId: OWNER,
  title: null,
  visibility: 'private',
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: DATE,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: baseline,
  recencyDigestTold: [],
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  workspaceRoot: null,
  workspaceExecutorId: null,
  workspaceGeneration: 0,
  workspaceTold: null,
  artifactSeq: 0,
  workspaceToldAvailable: null,
  workspaceToldFrom: null,
  workspaceDetachReason: null,
};

const model: SystemModelCatalogEntry = {
  id: 'system:test:model',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'test',
  providerModelId: 'test-model',
  systemPromptTemplate:
    '{{chats.compiledOn}}|{{chats.recentShown}}|{{#each chats.recent}}{{title}}|{{excerpt}}{{/each}}',
  systemPromptSource: 'model_override',
  referencesSkills: false,
};

const trigger: Message = {
  id: TRIGGER_ID,
  chatId: CHAT_ID,
  seq: 4,
  role: 'user',
  absorbedThroughSeq: null,
  senderUserId: OWNER,
  parts: [{ type: 'text', text: 'Continue' }],
  attachments: [],
  usage: null,
  inReplyTo: null,
  createdAt: DATE,
  revisedAt: null,
};

const laterTrigger: Message = { ...trigger, id: LATER_TRIGGER_ID, seq: 8 };

const run: Run = {
  id: RUN_ID,
  kind: 'turn',
  chatId: CHAT_ID,
  messageId: TRIGGER_ID,
  userId: OWNER,
  modelId: model.id,
  status: 'completed',
  wakeGeneration: 0,
  currentJobId: null,
  awaiting: null,
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  createdAt: DATE,
  startedAt: DATE,
  finishedAt: DATE,
  effort: null,
  permissionMode: 'default',
  activeAttemptId: ATTEMPT_ID,
  completedAttemptId: ATTEMPT_ID,
  turnToolAvailability: [],
  followUpAction: null,
  sourceRunId: null,
};

function event(
  eventType: string,
  payload: RunEvent['payload'],
  sequence: number,
): RunEvent {
  return { sequence, runId: RUN_ID, eventType, payload, createdAt: DATE };
}

function dispatchEvents(attemptId = ATTEMPT_ID): Array<RunEvent> {
  return [
    event(
      'run.suspended',
      {
        kind: 'quota',
        generation: 1,
        waitCount: 1,
        resumeAt: 'request',
        failureClass: 'quota_exhausted',
        attemptId,
        resetsAt: DATE.toISOString(),
        wakeAt: DATE.toISOString(),
        parts: [],
        steps: {},
        summaryAttemptId: attemptId,
        baselines: { recencyDigestInitialization: { baseline, told: [] } },
      },
      1,
    ),
    event('model.requested', { attemptId }, 2),
  ];
}

function makeRig(
  options: {
    chat?: Chat;
    runs?: Array<Run>;
    receipts?: Array<SystemPromptReceipt>;
    events?: Array<RunEvent>;
    model?: SystemModelCatalogEntry;
    models?: ReadonlyArray<SystemModelCatalogEntry>;
  } = {},
) {
  const db: Db = drizzle.mock();
  vi.spyOn(RunsRepository.prototype, 'findByChatId').mockResolvedValue(
    options.runs ?? [run],
  );
  vi.spyOn(
    SystemPromptReceiptsRepository.prototype,
    'findByOwnedRun',
  ).mockImplementation((runId) =>
    Promise.resolve(
      (options.receipts ?? []).filter((candidate) => candidate.runId === runId),
    ),
  );
  vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue(
    options.events ?? dispatchEvents(),
  );
  vi.spyOn(MessagesRepository.prototype, 'findById').mockImplementation(
    (chatId, ownerId, id) =>
      Promise.resolve(
        chatId === CHAT_ID && ownerId === OWNER
          ? [trigger, laterTrigger].find((message) => message.id === id)
          : undefined,
      ),
  );
  vi.spyOn(
    MessagesRepository.prototype,
    'findActiveCheckpoint',
  ).mockResolvedValue(undefined);
  vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([]);

  return reconstructDigestAttempts({
    tx: db,
    ownerId: OWNER,
    chat: options.chat ?? chat,
    models: options.models ?? [options.model ?? model],
    user: undefined,
    webSearch: undefined,
  });
}

function receipt(prompt: string, usingModel = model): SystemPromptReceipt {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    ownerUserId: OWNER,
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    source: usingModel.systemPromptSource,
    systemPrompt: prompt,
    promptHash: hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, prompt),
    createdAt: DATE,
  };
}

function renderedText(usingModel = model): string {
  return renderSystemPromptTemplate({
    template: usingModel.systemPromptTemplate,
    model: usingModel,
    anchor: formatTemporalAnchor(chat.createdAt, resolveInstanceTimezone()),
    chats: baseline,
    admittedToolIds: [],
    captureChatsFieldDisclosure: true,
  }).text;
}

afterEach(() => vi.restoreAllMocks());

describe('recency digest attempt evidence boundaries', () => {
  it('keeps the earliest proof for repeated title and scalar disclosures', async () => {
    const firstRun = {
      ...run,
      id: '33333333-3333-4333-8333-333333333331',
      messageId: LATER_TRIGGER_ID,
    };

    const usingModel = {
      ...model,
      systemPromptTemplate:
        '{{chats.compiledOn}}|{{#each chats.recent}}{{title}}{{/each}}',
    };

    const prompt = renderedText(usingModel);

    const attempts = await makeRig({
      runs: [firstRun, run],
      receipts: [
        { ...receipt(prompt, usingModel), runId: firstRun.id },
        { ...receipt(prompt, usingModel), runId: run.id },
      ],
      model: usingModel,
    });

    expect(
      attempts.proofCandidates.map(({ proofs }) => proofs.title),
    ).toMatchObject([
      { runId: firstRun.id, attemptId: ATTEMPT_ID },
      { runId: RUN_ID, attemptId: ATTEMPT_ID },
    ]);
    expect(attempts.scalarProofs.compiledOn).toMatchObject({
      runId: firstRun.id,
      attemptId: ATTEMPT_ID,
    });
    expect(attempts.matchedRun).toEqual({
      runId: firstRun.id,
      attemptId: ATTEMPT_ID,
    });
    expect(attempts.latestPreTurn).toEqual({ runId: firstRun.id, seq: 8 });
    expect(attempts.identityTitleProofs.get('Private title')).toMatchObject({
      proof: { runId: firstRun.id, attemptId: ATTEMPT_ID },
      told: [],
    });
    expect(attempts.baselinePublicationProved).toBe(true);
  });

  it('requires a real chats disclosure and the packaged default for membership evidence', async () => {
    const noChats = {
      ...model,
      systemPromptTemplate: 'Only unrelated content',
    };

    const unavailable = await makeRig({
      model: noChats,
      receipts: [receipt(renderedText(noChats), noChats)],
    });

    expect(unavailable.proofCandidates).toEqual([]);

    const defaultModel = {
      ...model,
      systemPromptTemplate: packagedTemplate,
      systemPromptSource: 'project_default' as const,
    };

    const prompt = renderedText(defaultModel);

    const overriddenModel = {
      ...defaultModel,
      systemPromptSource: 'model_override' as const,
    };

    const overridden = await makeRig({
      model: overriddenModel,
      receipts: [receipt(prompt, overriddenModel)],
    });

    expect(overridden.proofCandidates).toHaveLength(1);
    expect(overridden.baselineMembershipProofs.size).toBe(0);

    const changedDefault = {
      ...model,
      systemPromptSource: 'project_default' as const,
    };

    const changedDefaultPrompt = renderedText(changedDefault);

    const notPackaged = await makeRig({
      model: changedDefault,
      receipts: [receipt(changedDefaultPrompt, changedDefault)],
    });

    expect(notPackaged.proofCandidates).toHaveLength(1);
    expect(notPackaged.baselineMembershipProofs.size).toBe(0);

    const eligible = await makeRig({
      model: defaultModel,
      receipts: [receipt(prompt, defaultModel)],
    });

    expect(eligible.baselineMembershipProofs.has('Private title')).toBe(true);
  });

  it('rejects receipts without their exact request dispatch or publication witness', async () => {
    const noDispatch = await makeRig({
      receipts: [receipt('irrelevant')],
      events: [event('model.requested', { attemptId: 'different-attempt' }, 1)],
    });

    expect(noDispatch.attemptNotDispatched).toBe(true);
    expect(noDispatch.proofCandidates).toEqual([]);
    expect(noDispatch.anyReceipt).toBe(true);

    const noWitness = await makeRig({
      receipts: [receipt('irrelevant')],
      events: [event('model.requested', { attemptId: ATTEMPT_ID }, 1)],
    });

    expect(noWitness.baselinePublicationUnproved).toBe(true);
    expect(noWitness.baselinePublicationProved).toBe(false);
    expect(noWitness.proofCandidates).toEqual([]);
  });

  it('requires source, rendered text, and the domain-separated prompt hash to match independently', async () => {
    const prompt = renderedText();
    const matching = receipt(prompt);

    const sourceMismatch = await makeRig({
      receipts: [{ ...matching, source: 'project_default' }],
    });

    expect(sourceMismatch.matchedReceipt).toBe(false);
    expect(sourceMismatch.proofCandidates).toEqual([]);

    const textMismatch = await makeRig({
      receipts: [{ ...matching, systemPrompt: 'different prompt' }],
    });

    expect(textMismatch.matchedReceipt).toBe(false);
    expect(textMismatch.proofCandidates).toEqual([]);

    const hashMismatch = await makeRig({
      receipts: [{ ...matching, promptHash: 'wrong-hash' }],
    });

    expect(hashMismatch.matchedReceipt).toBe(false);
    expect(hashMismatch.proofCandidates).toEqual([]);
  });

  it('rejects stale skill baselines, unknown model ids, and unavailable tool state', async () => {
    const skillModel = { ...model, referencesSkills: true };

    const staleSkills = {
      ...chat,
      skillCatalogBaseline: { entries: [], omitted: 0 },
      skillCatalogRebakedFrom: '55555555-5555-4555-8555-555555555555',
    };

    const stale = await makeRig({
      chat: staleSkills,
      model: skillModel,
      receipts: [receipt('unreconstructable skill state', skillModel)],
    });

    expect(stale.candidateUnavailable).toBe(true);
    expect(stale.proofCandidates).toEqual([]);

    const unknownModel = await makeRig({
      models: [],
      receipts: [receipt(renderedText())],
    });

    expect(unknownModel.candidateUnavailable).toBe(true);
    expect(unknownModel.proofCandidates).toEqual([]);

    const validSkillChat = {
      ...chat,
      skillCatalogBaseline: {
        entries: [{ name: 'example', description: 'A skill' }],
        omitted: 0,
      },
      skillCatalogRebakedFrom: null,
    };

    const currentSkills = await makeRig({
      chat: validSkillChat,
      model: skillModel,
      receipts: [receipt(renderedText(skillModel), skillModel)],
    });

    expect(currentSkills.candidateUnavailable).toBe(false);
    expect(currentSkills.proofCandidates).toHaveLength(1);

    const invalidTemplate = { ...model, systemPromptTemplate: '{{#if chats}}' };

    const renderFailure = await makeRig({
      model: invalidTemplate,
      receipts: [receipt('irrelevant')],
    });

    expect(renderFailure.candidateUnavailable).toBe(true);
    expect(renderFailure.proofCandidates).toEqual([]);

    const noTools = await makeRig({
      runs: [{ ...run, turnToolAvailability: null }],
      receipts: [receipt(renderedText())],
    });

    expect(noTools.candidateUnavailable).toBe(true);
    expect(noTools.proofCandidates).toEqual([]);
  });
});
