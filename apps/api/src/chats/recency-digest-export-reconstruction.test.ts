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
import { buildRecencyDigestExportRecord } from './recency-digest-export-record';
import { SYSTEM_PROMPT_RECEIPT_DOMAIN } from './recency-digest-export-proof';
import {
  createRecencyDigestDeltaItem,
  createRecencyDigestSupersessionItem,
} from './recency-digest-item';

const PACKAGED_DEFAULT_TEMPLATE = readPromptSource(
  DEFAULT_CHAT_SYSTEM_PROMPT_PATH,
  DEFAULT_PROMPT_FILE_ACCESS,
);

const OWNER = 'owner-1';
const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const TRIGGER_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const CHECKPOINT_ID = '55555555-5555-4555-8555-555555555555';
const DATE = new Date('2026-11-23T12:00:00.000Z');

const baseline: RecencyDigestBaseline = {
  pinned: [],
  recent: [
    {
      title: 'Private digest title',
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

function renderedPrompt(usingModel = model) {
  return renderSystemPromptTemplate({
    template: usingModel.systemPromptTemplate,
    model: usingModel,
    anchor: formatTemporalAnchor(chat.createdAt, resolveInstanceTimezone()),
    chats: baseline,
    admittedToolIds: [],
    captureChatsFieldDisclosure: true,
  });
}

const initialTold = [
  {
    chatId: '66666666-6666-4666-8666-666666666666',
    pinned: false,
    title: 'Private digest title',
  },
];

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
  recencyDigestTold: [
    {
      chatId: '66666666-6666-4666-8666-666666666666',
      pinned: true,
      title: 'Private digest title',
    },
  ],
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
    '{{chats.compiledOn}}|{{chats.pinnedShown}}|{{chats.pinnedTotal}}|{{chats.recentShown}}|{{chats.recentTotal}}|{{#each chats.recent}}{{title}}{{/each}}',
  systemPromptSource: 'model_override',
  referencesSkills: false,
};

const packagedDefaultModel: SystemModelCatalogEntry = {
  ...model,
  systemPromptTemplate: PACKAGED_DEFAULT_TEMPLATE,
  systemPromptSource: 'project_default',
};

function triggerMessage(): Message {
  return {
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
}

function run(): Run {
  return {
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
}

function receipt(
  systemPrompt: string,
  attemptId = ATTEMPT_ID,
  usingModel = model,
): SystemPromptReceipt {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    ownerUserId: OWNER,
    runId: RUN_ID,
    attemptId,
    source: usingModel.systemPromptSource,
    systemPrompt,
    promptHash: hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, systemPrompt),
    createdAt: DATE,
  };
}

function event(
  eventType: string,
  payload: RunEvent['payload'],
  sequence: number,
): RunEvent {
  return { sequence, runId: RUN_ID, eventType, payload, createdAt: DATE };
}

function initializedDispatchEvents(told = initialTold): Array<RunEvent> {
  return [
    event(
      'run.suspended',
      {
        kind: 'quota',
        generation: 1,
        waitCount: 1,
        resumeAt: 'request',
        failureClass: 'quota_exhausted',
        attemptId: ATTEMPT_ID,
        resetsAt: DATE.toISOString(),
        wakeAt: DATE.toISOString(),
        parts: [],
        steps: {},
        summaryAttemptId: ATTEMPT_ID,
        baselines: {
          recencyDigestInitialization: {
            baseline,
            told,
          },
        },
      },
      1,
    ),
    event('model.requested', { attemptId: ATTEMPT_ID }, 2),
  ];
}

function makeRig(input: {
  chat?: Chat;
  runs?: Array<Run>;
  receipts?: Array<SystemPromptReceipt>;
  events?: Array<RunEvent>;
  destinationMessages?: Array<Message>;
  activeCheckpoint?: (Message & { absorbedThroughSeq: number }) | undefined;
  model?: SystemModelCatalogEntry;
}) {
  const db: Db = drizzle.mock();

  const findRuns = vi
    .spyOn(RunsRepository.prototype, 'findByChatId')
    .mockResolvedValue(input.runs ?? []);

  const findReceiptRows = vi
    .spyOn(SystemPromptReceiptsRepository.prototype, 'findByOwnedRun')
    .mockResolvedValue(input.receipts ?? []);

  const listEvents = vi
    .spyOn(RunEventsRepository.prototype, 'listByRunId')
    .mockResolvedValue(input.events ?? []);

  const findById = vi
    .spyOn(MessagesRepository.prototype, 'findById')
    .mockImplementation((chatId, ownerId, id) =>
      Promise.resolve(
        chatId === CHAT_ID && ownerId === OWNER && id === TRIGGER_ID
          ? triggerMessage()
          : undefined,
      ),
    );

  const findActiveCheckpoint = vi
    .spyOn(MessagesRepository.prototype, 'findActiveCheckpoint')
    .mockImplementation((chatId, ownerId) =>
      Promise.resolve(
        chatId === CHAT_ID && ownerId === OWNER
          ? input.activeCheckpoint
          : undefined,
      ),
    );

  const findByChatId = vi
    .spyOn(MessagesRepository.prototype, 'findByChatId')
    .mockResolvedValue(input.destinationMessages ?? []);

  return {
    async export() {
      const exportChat = input.chat ?? chat;

      const attempts = await reconstructDigestAttempts({
        tx: db,
        ownerId: OWNER,
        chat: exportChat,
        models: [input.model ?? model],
        user: undefined,
        webSearch: undefined,
      });

      return {
        attempts,
        record: buildRecencyDigestExportRecord({
          ownerId: OWNER,
          chat: exportChat,
          attempts,
        }),
      };
    },
    spies: {
      findRuns,
      findReceiptRows,
      listEvents,
      findById,
      findActiveCheckpoint,
      findByChatId,
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('recency digest export reconstruction consumer path', () => {
  it('proves only the immutable receipt attempt whose exact dispatch and rendered prompt agree', async () => {
    const renderedText = renderedPrompt().text;
    const candidate = receipt(renderedText);

    const rig = makeRig({
      runs: [run()],
      receipts: [candidate],
      events: initializedDispatchEvents().map((row) =>
        row.eventType === 'model.requested'
          ? {
              ...row,
              payload: { attemptId: '88888888-8888-4888-8888-888888888888' },
            }
          : row,
      ),
    });

    const { record: mismatchedDispatch, attempts: notDispatched } =
      await rig.export();

    expect(notDispatched.attemptNotDispatched).toBe(true);
    expect(mismatchedDispatch.baseline.entries).toEqual([]);

    rig.spies.listEvents.mockResolvedValue(initializedDispatchEvents());
    rig.spies.findReceiptRows.mockResolvedValue([receipt('different prompt')]);

    const { attempts: mismatchedReceipt, record: receiptMismatchRecord } =
      await rig.export();

    expect(mismatchedReceipt.anyReceipt).toBe(true);
    expect(mismatchedReceipt.matchedReceipt).toBe(false);
    expect(receiptMismatchRecord.baseline.entries).toEqual([]);

    rig.spies.findReceiptRows.mockResolvedValue([candidate]);
    const { record, attempts } = await rig.export();

    expect(attempts.matchedReceipt).toBe(true);
    expect(attempts.proofCandidates).toMatchObject([
      {
        list: 'recent',
        index: 0,
        fields: { title: 'Private digest title' },
        proofs: { title: { runId: RUN_ID, attemptId: ATTEMPT_ID } },
      },
    ]);
    expect(record.baseline.entries).toMatchObject([
      {
        list: 'recent',
        index: 0,
        fields: { title: 'Private digest title' },
        proofs: { title: { attemptId: ATTEMPT_ID } },
      },
    ]);
    expect(record.baseline).toMatchObject({
      compiledOn: '2026-11-23',
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 1,
      recentTotal: 1,
      scalarProofs: {
        compiledOn: { attemptId: ATTEMPT_ID },
        pinnedShown: { attemptId: ATTEMPT_ID },
        pinnedTotal: { attemptId: ATTEMPT_ID },
        recentShown: { attemptId: ATTEMPT_ID },
        recentTotal: { attemptId: ATTEMPT_ID },
      },
    });
    expect(JSON.stringify(record)).not.toContain('Private excerpt');
  });

  it('fails closed when an initial baseline lacks its quota-initialization witness and emits safe generic omissions', async () => {
    const rig = makeRig({
      runs: [run()],
      receipts: [receipt(renderedPrompt().text)],
      events: [event('model.requested', { attemptId: ATTEMPT_ID }, 1)],
    });

    const { attempts, record } = await rig.export();

    expect(attempts.baselinePublicationUnproved).toBe(true);
    expect(attempts.proofCandidates).toEqual([]);
    expect(record.baseline).not.toHaveProperty('compiledOn');
    expect(record.baseline.omissions).toEqual([
      {
        list: 'recent',
        index: 0,
        field: 'title',
        reason: 'baseline_input_unproved',
      },
      {
        list: 'recent',
        index: 0,
        field: 'date',
        reason: 'baseline_input_unproved',
      },
      {
        list: 'recent',
        index: 0,
        field: 'messageCount',
        reason: 'baseline_input_unproved',
      },
      {
        list: 'recent',
        index: 0,
        field: 'excerpt',
        reason: 'baseline_input_unproved',
      },
    ]);
    expect(record.omissions).toContainEqual({
      scope: 'baseline',
      field: '*',
      reason: 'baseline_input_unproved',
    });
    expect(JSON.stringify(record)).not.toContain('Private digest title');
  });

  it('uses the latest literal pin correction in the active destination epoch', async () => {
    const beforeBoundary: Message = {
      ...triggerMessage(),
      id: '99999999-9999-4999-8999-999999999999',
      seq: 5,
      parts: [
        createRecencyDigestDeltaItem({
          runId: RUN_ID,
          payload: {
            entries: [],
            pinChanges: [{ title: 'Private digest title', pinned: true }],
          },
        }),
      ],
    };

    const afterBoundary: Message = {
      ...triggerMessage(),
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      seq: 7,
      parts: [
        createRecencyDigestDeltaItem({
          runId: RUN_ID,
          payload: {
            entries: [],
            pinChanges: [{ title: 'Private digest title', pinned: true }],
          },
        }),
        createRecencyDigestDeltaItem({
          runId: RUN_ID,
          payload: {
            entries: [],
            pinChanges: [{ title: 'Private digest title', pinned: false }],
          },
        }),
        createRecencyDigestDeltaItem({
          runId: RUN_ID,
          payload: {
            entries: [],
            pinChanges: [{ title: 'Private digest title', pinned: true }],
          },
        }),
      ],
    };

    const checkpoint = {
      ...triggerMessage(),
      id: CHECKPOINT_ID,
      seq: 6,
      role: 'checkpoint' as const,
      absorbedThroughSeq: 5,
      senderUserId: null,
      parts: [],
    };

    const rig = makeRig({
      runs: [run()],
      receipts: [receipt(renderedPrompt().text)],
      events: initializedDispatchEvents(),
      destinationMessages: [beforeBoundary, checkpoint, afterBoundary],
      activeCheckpoint: checkpoint,
    });

    const { attempts, record } = await rig.export();

    expect(attempts.activeCheckpointId).toBe(CHECKPOINT_ID);
    expect(attempts.lastOriginalSeq).toBe(7);
    expect(attempts.pinCorrectionUnproved).toBe(false);
    expect(record.comparison.entries).toMatchObject([
      {
        chatId: '66666666-6666-4666-8666-666666666666',
        pinned: true,
        title: 'Private digest title',
        proofs: {
          identity: { runId: RUN_ID, attemptId: ATTEMPT_ID },
          pin: {
            kind: 'notice',
            messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        },
      },
    ]);

    rig.spies.findByChatId.mockResolvedValue([beforeBoundary, checkpoint]);
    const { record: withoutEffectiveCorrection } = await rig.export();

    expect(withoutEffectiveCorrection.comparison.entries).toEqual([]);
  });
  it('does not let mutable told titles identify an immutable baseline row', async () => {
    const rig = makeRig({
      runs: [run()],
      receipts: [receipt(renderedPrompt().text)],
      events: initializedDispatchEvents([
        {
          chatId: '99999999-9999-4999-8999-999999999999',
          pinned: false,
          title: 'A different immutable title',
        },
      ]),
    });

    const { record } = await rig.export();

    expect(record.comparison.entries).toEqual([]);
  });

  it('keeps field proofs when immutable initialization told is empty without proving identity', async () => {
    const rig = makeRig({
      runs: [run()],
      receipts: [receipt(renderedPrompt().text)],
      events: initializedDispatchEvents([]),
    });

    const { record } = await rig.export();

    expect(record.baseline.entries).toMatchObject([
      { fields: { title: 'Private digest title' } },
    ]);
    expect(record.comparison.entries).toEqual([]);
  });

  it('omits baseline membership for a custom title-only prompt', async () => {
    const rig = makeRig({
      runs: [run()],
      receipts: [receipt(renderedPrompt().text)],
      events: initializedDispatchEvents(),
    });

    const { record } = await rig.export();

    expect(record.comparison.entries).toEqual([]);
    expect(record.comparison.omissions).toContainEqual({
      chatId: '66666666-6666-4666-8666-666666666666',
      field: 'pin',
      reason: 'pin_unproved',
    });
  });

  it('proves baseline membership from the packaged project default prompt', async () => {
    const prompt = renderedPrompt(packagedDefaultModel);

    const rig = makeRig({
      runs: [run()],
      receipts: [receipt(prompt.text, ATTEMPT_ID, packagedDefaultModel)],
      events: initializedDispatchEvents(),
      model: packagedDefaultModel,
    });

    const { record } = await rig.export();

    expect(record.comparison.entries).toMatchObject([
      {
        chatId: '66666666-6666-4666-8666-666666666666',
        pinned: false,
        title: 'Private digest title',
        proofs: {
          identity: { runId: RUN_ID, attemptId: ATTEMPT_ID },
          pin: {
            kind: 'baseline',
            proof: { runId: RUN_ID, attemptId: ATTEMPT_ID },
          },
        },
      },
    ]);
  });

  it.each([true, false])(
    'privately reports unmatched told inventory with baseline present=%s',
    async (withBaseline) => {
      const unprovedId = '88888888-8888-4888-8888-888888888888';

      const rig = makeRig({
        chat: {
          ...chat,
          recencyDigestBaseline: withBaseline ? baseline : null,
          recencyDigestTold: [{ chatId: unprovedId, pinned: true }],
        },
        runs: [],
        receipts: [],
        events: [],
      });

      const { record } = await rig.export();

      expect(record.comparison.entries).toEqual([]);
      expect(record.comparison.omissions).toContainEqual({
        chatId: unprovedId,
        field: 'identity',
        reason: 'unproved_told_id',
      });
      expect(record.omissions).toContainEqual({
        scope: 'comparison',
        field: '*',
        reason: 'comparison_proof_unavailable',
      });
    },
  );

  it('preserves the last notice proof after a snapshot reset within one message without mutating stored parts', async () => {
    const prior: Message = {
      ...triggerMessage(),
      id: '99999999-9999-4999-8999-999999999999',
      seq: 5,
      parts: [
        createRecencyDigestDeltaItem({
          runId: RUN_ID,
          payload: {
            entries: [],
            pinChanges: [{ title: 'Private digest title', pinned: false }],
          },
        }),
      ],
    };

    const final: Message = {
      ...triggerMessage(),
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      seq: 6,
      parts: [
        createRecencyDigestSupersessionItem({ runId: RUN_ID }),
        createRecencyDigestDeltaItem({
          runId: RUN_ID,
          payload: {
            entries: [],
            pinChanges: [{ title: 'Private digest title', pinned: true }],
          },
        }),
      ],
    };

    const messages = [prior, final];
    const before = JSON.stringify(messages);

    const rig = makeRig({
      runs: [run()],
      receipts: [receipt(renderedPrompt().text)],
      events: initializedDispatchEvents(),
      destinationMessages: messages,
    });

    const { record } = await rig.export();

    expect(record.comparison.entries).toMatchObject([
      {
        chatId: initialTold[0]?.chatId,
        pinned: true,
        proofs: { pin: { kind: 'notice', messageId: final.id } },
      },
    ]);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it('omits a pin correction when the current epoch has only legacy data without visible text', async () => {
    const legacyDataOnlyMessage: Message = {
      ...triggerMessage(),
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      seq: 7,
      parts: [
        {
          type: 'data-context',
          data: {
            v: 1,
            producer: 'recency-digest',
            form: 'notice',
            runId: RUN_ID,
            payload: {
              entries: [],
              pinChanges: [{ title: 'Private digest title', pinned: false }],
            },
          },
        },
      ],
    };

    const checkpoint = {
      ...triggerMessage(),
      id: CHECKPOINT_ID,
      seq: 6,
      role: 'checkpoint' as const,
      absorbedThroughSeq: 5,
      senderUserId: null,
      parts: [],
    };

    const rig = makeRig({
      runs: [run()],
      receipts: [receipt(renderedPrompt().text)],
      events: initializedDispatchEvents(),
      destinationMessages: [checkpoint, legacyDataOnlyMessage],
      activeCheckpoint: checkpoint,
    });

    const { attempts, record } = await rig.export();

    expect(attempts.pinCorrectionUnproved).toBe(true);
    expect(record.comparison.entries).toEqual([]);
    expect(record.comparison.omissions).toContainEqual({
      chatId: '66666666-6666-4666-8666-666666666666',
      field: 'pin',
      reason: 'pin_unproved',
    });
  });

  it('uses the rebake marker checkpoint as publication evidence only for later dispatches', async () => {
    const marker = {
      ...triggerMessage(),
      id: CHECKPOINT_ID,
      seq: 3,
      role: 'checkpoint' as const,
      absorbedThroughSeq: 2,
      senderUserId: null,
      parts: [],
    };

    const rebakedChat: Chat = {
      ...chat,
      recencyDigestRebakedFrom: CHECKPOINT_ID,
    };

    const eventRows = [
      {
        ...event('model.requested', { attemptId: ATTEMPT_ID }, 1),
        createdAt: new Date(DATE.getTime() + 1),
      },
    ];

    const rig = makeRig({
      chat: rebakedChat,
      runs: [run()],
      receipts: [receipt(renderedPrompt().text)],
      events: eventRows,
    });

    rig.spies.findById.mockImplementation((chatId, ownerId, id) =>
      Promise.resolve(
        chatId === CHAT_ID && ownerId === OWNER && id === CHECKPOINT_ID
          ? marker
          : id === TRIGGER_ID
            ? triggerMessage()
            : undefined,
      ),
    );
    rig.spies.findActiveCheckpoint.mockImplementation(
      (chatId, ownerId, options) =>
        Promise.resolve(
          chatId === CHAT_ID && ownerId === OWNER && options.beforeSeq === 4
            ? marker
            : undefined,
        ),
    );

    rig.spies.listEvents.mockResolvedValue([
      event('model.requested', { attemptId: ATTEMPT_ID }, 1),
    ]);
    const { record: sameTime } = await rig.export();
    expect(sameTime.baseline.entries).toEqual([]);

    rig.spies.listEvents.mockResolvedValue(eventRows);
    const { record } = await rig.export();
    expect(record.baseline.entries).toMatchObject([
      {
        list: 'recent',
        index: 0,
        fields: { title: 'Private digest title' },
        proofs: { title: { runId: RUN_ID, attemptId: ATTEMPT_ID } },
      },
    ]);
    expect(record.omissions).not.toContainEqual({
      scope: 'baseline',
      field: '*',
      reason: 'baseline_input_unproved',
    });
  });
});
