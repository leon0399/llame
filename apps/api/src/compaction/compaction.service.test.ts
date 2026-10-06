import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type ToolSet } from 'ai';

import type {
  Message,
  ModelToolDeclaration,
  Run,
  SystemPromptReceipt,
} from '../db/schema';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { createFakeModelClient } from '../models/fake-model-client';
import { wrapStreamTextResult } from '../models/stream-text-result-proxy';
import type { ModelClient, ModelStreamInput } from '../models/model-client';
import { createCompactionCheckpointPart } from '../chats/context-item-producers';
import {
  MessagesRepository,
  type CheckpointMessage,
} from '../chats/messages-repository';
import { SystemPromptReceiptsRepository } from '../runs/system-prompt-receipts.repository';
import { RunsRepository } from '../runs/runs-repository';
import { ContextIncompatibleError } from '../runs/model-context-errors';
import type { CompactionPlan } from './compaction';
import {
  COMPACTION_INSTRUCTION,
  TRANSITION_COMPACTION_INSTRUCTION,
} from './compaction';
import { CompactionService, toStoredMessages } from './compaction.service';

const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId = 'owner-1';
const now = new Date('2026-09-01T00:00:00.000Z');

function message(seq: number, role: Message['role'] = 'user'): Message {
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${seq.toString().padStart(12, '0')}`,
    chatId,
    seq,
    role,
    senderUserId: role === 'user' ? ownerId : null,
    parts: [{ type: 'text', text: `message ${seq}` }],
    attachments: [],
    usage: null,
    absorbedThroughSeq: null,
    inReplyTo: null,
    createdAt: now,
  };
}

/**
 * The absorbable prefix an attempt's plan hands to the summary request. It
 * starts strictly above `previousCheckpoint.absorbedThroughSeq`, whose stored
 * checkpoint is replayed in its place.
 */
function plan(): CompactionPlan {
  return {
    uptoSeq: 2,
    absorb: toStoredMessages([message(2, 'assistant')]),
  };
}

const previousCheckpoint: CheckpointMessage = {
  ...message(1, 'checkpoint'),
  absorbedThroughSeq: 1,
  parts: [createCompactionCheckpointPart('previous checkpoint')],
};

const sourceAttemptId = '22222222-2222-4222-8222-222222222222';
const sourceRun: Run = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  chatId,
  messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  userId: ownerId,
  modelId: 'source-model-1',
  activeAttemptId: null,
  completedAttemptId: sourceAttemptId,
  turnToolAvailability: [],
  status: 'completed',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: now,
  startedAt: now,
  finishedAt: now,
  effort: null,
  permissionMode: 'default' as const,
};

const sourceReceipt: SystemPromptReceipt = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerUserId: ownerId,
  runId: sourceRun.id,
  attemptId: sourceAttemptId,
  source: 'project_default',
  systemPrompt: 'the source run system prompt',
  promptHash: 'source-prompt-hash',
  createdAt: now,
};

function makeService(client: ModelClient = createFakeModelClient(['summary'])) {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  );
  const models = {
    createClient: vi.fn((_modelId: string) => client),
  };
  return {
    service: new CompactionService(tenantDb, models),
    models,
    client,
  };
}

type StreamOverrides = Parameters<typeof wrapStreamTextResult>[1];

/** A fake client that records what `streamText` was handed and lets a test
 * substitute the provider-side `toolCalls`/`finishReason` promises. */
function recordingClient(options?: {
  responses?: Array<string>;
  contextWindowTokens?: number;
  overrides?: StreamOverrides;
}) {
  const base = createFakeModelClient(
    options?.responses ?? ['summary text'],
    options?.contextWindowTokens ?? 128_000,
  );
  const calls: Array<ModelStreamInput> = [];
  const client: ModelClient = {
    ...base,
    streamText: (input: ModelStreamInput) => {
      calls.push(input);
      return wrapStreamTextResult(
        base.streamText(input),
        options?.overrides ?? {},
      );
    },
  };
  return { client, calls };
}

const validTool: ModelToolDeclaration = {
  id: 'search',
  description: 'Search things.',
  inputSchema: { type: 'object', properties: {} },
};

/**
 * The threshold variant needs only the active checkpoint read; the window
 * variant additionally resolves its source run and that run's receipt.
 */
function mockReads(options?: {
  previous?: CheckpointMessage;
  source?: { run: Run; receipt?: SystemPromptReceipt | undefined } | undefined;
}) {
  const findActive = vi
    .spyOn(MessagesRepository.prototype, 'findActiveCheckpoint')
    .mockResolvedValue(options?.previous);
  const findRun = vi.spyOn(
    RunsRepository.prototype,
    'findMostRecentCompletedByChatMessageSequence',
  );
  findRun.mockResolvedValue(
    options?.source
      ? { run: options.source.run, triggeringUserSeq: 1 }
      : undefined,
  );
  const findReceipt = vi
    .spyOn(SystemPromptReceiptsRepository.prototype, 'findByAttempt')
    .mockResolvedValue(options?.source?.receipt);
  return { findActive, findRun, findReceipt };
}

describe('CompactionService pure message boundary', () => {
  it('copies stored messages and rejects malformed JSON parts', () => {
    expect(toStoredMessages([message(1)])).toEqual([message(1)]);
    expect(() => toStoredMessages([{ ...message(1), parts: [null] }])).toThrow(
      /Malformed message part/,
    );
  });
});

describe('CompactionService.summarizeCheckpoint (threshold variant)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('summarizes with the attempt own client, prompt, schema-only tools and instruction', async () => {
    const { client, calls } = recordingClient();
    const setup = makeService(client);
    const { findActive } = mockReads({ previous: previousCheckpoint });

    const summary = await setup.service.summarizeCheckpoint({
      variant: 'threshold',
      chatId,
      userId: ownerId,
      triggeringUserSeq: 3,
      plan: plan(),
      client,
      system: 'the attempt pre-rebake system prompt',
      toolDeclarations: [validTool],
      effort: 'high',
    });

    // The read is scoped to the checkpoint that is active for THIS turn.
    expect(findActive).toHaveBeenCalledWith(chatId, ownerId, { beforeSeq: 3 });

    const sent = calls[0];
    expect(sent?.system).toBe('the attempt pre-rebake system prompt');
    // provider-api-selection D5: the request prefix IS the conversation's
    // prefix, so it shares the turn's own cache identity on the main lane.
    expect(sent?.chat).toStrictEqual({ id: chatId, lane: 'main' });
    expect(sent?.toolChoice).toBe('none');
    expect(sent?.effort).toBe('high');

    // Schema-only declarations: named and described, never executable — the
    // summarizer has no tool to call even though the turn's tools are declared.
    const tools: ToolSet = sent?.tools ?? {};
    expect(Object.keys(tools)).toEqual(['search']);
    expect(Object.values(tools).map((entry) => entry.execute)).toEqual([
      undefined,
    ]);

    // The trailing instruction is the threshold one, after the compacted
    // prefix (previous checkpoint first, then the absorbed turns).
    expect(sent?.messages.at(-1)).toEqual({
      role: 'user',
      content: COMPACTION_INSTRUCTION,
    });
    const rendered = JSON.stringify(sent?.messages);
    expect(rendered).toContain('previous checkpoint');
    expect(rendered.indexOf('previous checkpoint')).toBeLessThan(
      rendered.indexOf('message 2'),
    );
    expect(rendered).not.toContain(TRANSITION_COMPACTION_INSTRUCTION);

    expect(summary).toMatchObject({
      uptoSeq: 2,
      summary: 'summary text',
    });
  });

  it('omits effort from the request and the recorded usage when the turn had none', async () => {
    const { client, calls } = recordingClient();
    const setup = makeService(client);
    mockReads();

    const summary = await setup.service.summarizeCheckpoint({
      variant: 'threshold',
      chatId,
      userId: ownerId,
      triggeringUserSeq: 3,
      plan: plan(),
      client,
      system: 'system',
      toolDeclarations: [],
    });

    expect(Object.keys(calls[0] ?? {})).not.toContain('effort');
    expect(summary?.usage).not.toHaveProperty('effort');
  });

  it('records the summarization call usage with the attempt model and billing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { client } = recordingClient();
    Object.assign(client, { billing: 'subscription' });
    const setup = makeService(client);
    mockReads();

    const summary = await setup.service.summarizeCheckpoint({
      variant: 'threshold',
      chatId,
      userId: ownerId,
      triggeringUserSeq: 3,
      plan: plan(),
      client,
      system: 'system',
      toolDeclarations: [],
      effort: 'high',
    });

    expect(summary?.usage).toMatchObject({
      modelId: 'fake-model',
      effort: 'high',
      billing: 'subscription',
      status: 'completed',
      finishReason: 'stop',
      latencyMs: 0,
    });
  });

  it('sends no tools at all when the attempt declared none', async () => {
    const { client, calls } = recordingClient();
    const setup = makeService(client);
    mockReads();

    await setup.service.summarizeCheckpoint({
      variant: 'threshold',
      chatId,
      userId: ownerId,
      triggeringUserSeq: 3,
      plan: plan(),
      client,
      system: 'system',
      toolDeclarations: [],
    });

    // `tools` is absent rather than an empty set, so a tool-less request is
    // byte-identical to the turn's own tool-less request.
    expect(Object.keys(calls[0] ?? {})).not.toContain('tools');
  });

  it('rejects the summary when the provider returned a tool call despite toolChoice none', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { client } = recordingClient({
      overrides: {
        toolCalls: () => ({
          value: Promise.resolve([
            { toolCallId: 't1', toolName: 'search', input: {} },
          ]),
        }),
        finishReason: () => ({ value: Promise.resolve('stop') }),
      },
    });
    const setup = makeService(client);
    mockReads();

    // A checkpoint may be summary text and nothing else: this request declared
    // no tools, so a call has no executor here and its output is not text.
    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'threshold',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        client,
        system: 'system',
        toolDeclarations: [],
      }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      `Compaction summary came back empty for chat ${chatId}; proceeding without a checkpoint`,
    );
  });

  it('rejects the summary when the provider ended on tool calls', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { client } = recordingClient({
      overrides: {
        toolCalls: () => ({ value: Promise.resolve([]) }),
        finishReason: () => ({ value: Promise.resolve('tool-calls') }),
      },
    });
    const setup = makeService(client);
    mockReads();

    // A provider that ignored `toolChoice: 'none'` is the same rejection, even
    // when its tool-call list came back empty.
    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'threshold',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        client,
        system: 'system',
        toolDeclarations: [],
      }),
    ).resolves.toBeNull();
  });

  it('keeps the summary when the provider tool-call promise rejects', async () => {
    const { client } = recordingClient({
      overrides: {
        toolCalls: () => ({
          value: Promise.reject(new Error('no tool calls reported')),
        }),
      },
    });
    const setup = makeService(client);
    mockReads();

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'threshold',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        client,
        system: 'system',
        toolDeclarations: [],
      }),
    ).resolves.toMatchObject({ summary: 'summary text' });
  });

  it('warns and returns null for an empty summary', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { client } = recordingClient({ responses: [''] });
    const setup = makeService(client);
    mockReads();

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'threshold',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        client,
        system: 'system',
        toolDeclarations: [],
      }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      `Compaction summary came back empty for chat ${chatId}; proceeding without a checkpoint`,
    );
  });

  it('warns and returns null when the provider call fails outright', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const base = createFakeModelClient(['summary']);
    const client: ModelClient = {
      ...base,
      streamText: () => {
        throw new Error('provider unavailable');
      },
    };
    const setup = makeService(client);
    mockReads();

    // The request already fits its window, so a checkpoint is a nice-to-have:
    // the attempt proceeds without one instead of failing the turn.
    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'threshold',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        client,
        system: 'system',
        toolDeclarations: [],
      }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      `Compaction summary failed for chat ${chatId}; proceeding without a checkpoint`,
    );
  });

  it('rethrows the original failure when the attempt was aborted', async () => {
    const controller = new AbortController();
    const aborted = new Error('aborted mid-stream');
    const base = createFakeModelClient(['summary']);
    const client: ModelClient = {
      ...base,
      streamText: () => {
        controller.abort();
        throw aborted;
      },
    };
    const setup = makeService(client);
    mockReads();

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'threshold',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        client,
        system: 'system',
        toolDeclarations: [],
        abortSignal: controller.signal,
      }),
    ).rejects.toBe(aborted);
  });

  it('refuses to start once the attempt signal is already aborted', async () => {
    const setup = makeService();
    const { findActive } = mockReads();
    const controller = new AbortController();
    const aborted = new Error('attempt aborted before summarizing');
    controller.abort(aborted);

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'threshold',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        client: setup.client,
        system: 'system',
        toolDeclarations: [],
        abortSignal: controller.signal,
      }),
    ).rejects.toBe(aborted);
    // No summary call, and no read of the checkpoint lineage either.
    expect(findActive).not.toHaveBeenCalled();
  });
});

describe('CompactionService.summarizeCheckpoint (window variant)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('summarizes with the previous completed run model, receipt prompt and persisted effort', async () => {
    const { client, calls } = recordingClient();
    const setup = makeService(client);
    const { findRun, findReceipt } = mockReads({
      previous: previousCheckpoint,
      source: { run: { ...sourceRun, effort: 'high' }, receipt: sourceReceipt },
    });

    const summary = await setup.service.summarizeCheckpoint({
      variant: 'window',
      chatId,
      userId: ownerId,
      triggeringUserSeq: 3,
      plan: plan(),
      reservedOutputTokens: 10,
    });

    // The source is the previous completed run, scoped below this turn.
    expect(findRun).toHaveBeenCalledWith(chatId, ownerId, { beforeSeq: 3 });
    expect(findReceipt).toHaveBeenCalledWith(
      sourceRun.id,
      sourceAttemptId,
      ownerId,
    );
    // The TARGET model cannot hold the prefix, so it is not the one asked.
    expect(setup.models.createClient).toHaveBeenCalledWith('source-model-1');

    const sent = calls[0];
    // The source run own receipt prompt, so the prefix stays cache-aligned
    // with the history that run actually replayed.
    expect(sent?.system).toBe(sourceReceipt.systemPrompt);
    expect(sent?.effort).toBe('high');
    expect(sent?.chat).toStrictEqual({ id: chatId, lane: 'main' });
    // A summary is text only: no declarations ride along here.
    expect(Object.keys(sent ?? {})).not.toContain('tools');
    expect(sent?.toolChoice).toBe('none');
    expect(sent?.messages.at(-1)).toEqual({
      role: 'user',
      content: TRANSITION_COMPACTION_INSTRUCTION,
    });

    expect(summary).toMatchObject({ uptoSeq: 2, summary: 'summary text' });
    expect(summary?.usage).toMatchObject({ effort: 'high' });
  });

  it('omits effort when the source run persisted none', async () => {
    const { client, calls } = recordingClient();
    const setup = makeService(client);
    mockReads({ source: { run: sourceRun, receipt: sourceReceipt } });

    const summary = await setup.service.summarizeCheckpoint({
      variant: 'window',
      chatId,
      userId: ownerId,
      triggeringUserSeq: 3,
      plan: plan(),
      reservedOutputTokens: 10,
    });

    expect(Object.keys(calls[0] ?? {})).not.toContain('effort');
    expect(summary?.usage).not.toHaveProperty('effort');
  });

  it('fails context_incompatible when there is no previous completed run to summarize', async () => {
    const { client, calls } = recordingClient();
    const setup = makeService(client);
    mockReads();

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'window',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        reservedOutputTokens: 10,
      }),
    ).rejects.toBeInstanceOf(ContextIncompatibleError);
    expect(calls).toHaveLength(0);
  });

  it('fails context_incompatible when the source run has no completed attempt to read a receipt from', async () => {
    const { client, calls } = recordingClient();
    const setup = makeService(client);
    const { findReceipt } = mockReads({
      source: { run: { ...sourceRun, completedAttemptId: null } },
    });

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'window',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        reservedOutputTokens: 10,
      }),
    ).rejects.toMatchObject({
      code: 'context_incompatible',
      message:
        'The complete request exceeds the target model context window and no previous completed run can summarize its history.',
    });
    expect(calls).toHaveLength(0);
    expect(findReceipt).not.toHaveBeenCalled();
  });

  it('fails context_incompatible when its receipt is gone', async () => {
    const { client, calls } = recordingClient();
    const setup = makeService(client);
    mockReads({ source: { run: sourceRun, receipt: undefined } });

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'window',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        reservedOutputTokens: 10,
      }),
    ).rejects.toMatchObject({
      code: 'context_incompatible',
      message:
        'The complete request exceeds the target model context window and no previous completed run can summarize its history.',
    });
    expect(calls).toHaveLength(0);
  });

  it('names the unavailable source model and keeps its cause', async () => {
    const setup = makeService();
    const modelError = new Error('model unavailable');
    mockReads({ source: { run: sourceRun, receipt: sourceReceipt } });
    setup.models.createClient.mockImplementation(() => {
      throw modelError;
    });

    const failure = await setup.service
      .summarizeCheckpoint({
        variant: 'window',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        reservedOutputTokens: 10,
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ContextIncompatibleError);
    expect(failure).toMatchObject({
      message:
        "Source model 'source-model-1' is unavailable to summarize the history this request carries.",
      cause: modelError,
    });
  });

  it('fails context_incompatible when the source model cannot fit the summary request either', async () => {
    const { client, calls } = recordingClient({ contextWindowTokens: 1000 });
    const setup = makeService(client);
    mockReads({ source: { run: sourceRun, receipt: sourceReceipt } });

    const failure = await setup.service
      .summarizeCheckpoint({
        variant: 'window',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        reservedOutputTokens: 10_000_000,
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ContextIncompatibleError);
    expect(failure).toMatchObject({
      message:
        'The complete request exceeds the target model context window and its source model cannot fit that history either.',
    });
    expect(calls).toHaveLength(0);
  });

  it('fails context_incompatible when the source model returns no usable summary', async () => {
    const { client } = recordingClient({ responses: [''] });
    const setup = makeService(client);
    mockReads({ source: { run: sourceRun, receipt: sourceReceipt } });

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'window',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        reservedOutputTokens: 10,
      }),
    ).rejects.toMatchObject({
      message: 'Source-model summarization returned no valid text summary.',
    });
  });

  it('wraps a source-model failure and preserves its cause', async () => {
    const boom = new Error('provider exploded');
    const base = createFakeModelClient(['summary']);
    const client: ModelClient = {
      ...base,
      streamText: () => {
        throw boom;
      },
    };
    const setup = makeService(client);
    mockReads({ source: { run: sourceRun, receipt: sourceReceipt } });

    const failure = await setup.service
      .summarizeCheckpoint({
        variant: 'window',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        reservedOutputTokens: 10,
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ContextIncompatibleError);
    expect(failure).toMatchObject({
      message:
        'Source-model summarization of the history this request carries failed.',
      cause: boom,
    });
  });

  it('rethrows the original failure when the window summary was aborted', async () => {
    const controller = new AbortController();
    const aborted = new Error('aborted mid-summary');
    const base = createFakeModelClient(['summary']);
    const client: ModelClient = {
      ...base,
      streamText: () => {
        controller.abort();
        throw aborted;
      },
    };
    const setup = makeService(client);
    mockReads({ source: { run: sourceRun, receipt: sourceReceipt } });

    await expect(
      setup.service.summarizeCheckpoint({
        variant: 'window',
        chatId,
        userId: ownerId,
        triggeringUserSeq: 3,
        plan: plan(),
        reservedOutputTokens: 10,
        abortSignal: controller.signal,
      }),
    ).rejects.toBe(aborted);
  });
});
