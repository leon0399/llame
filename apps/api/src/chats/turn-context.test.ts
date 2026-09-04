import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type {
  ToolAvailabilityManifestV1,
  TurnToolCandidate,
} from '../tools/turn-tool-catalog';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { Db } from '../db/tenant-db.service';
import type { Chat, Compaction, ModelContextSnapshot, Run } from '../db/schema';
import { ChatsRepository, CompactionsRepository } from './chats-repository';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { RunsRepository } from '../runs/runs-repository';
import type { MessagePart } from './context-builder';
import type { PersistUserMessageAndRunInput } from './chat-loop.service';
import type {
  RecencyDigestDelta,
  RecencyDigestResolution,
} from './recency-digest.service';
import {
  buildTurnContextAndParts,
  resolveTurnContext,
  type TurnContextDeps,
} from './turn-context';
import { isContextItemPart } from './context-item';
import { vi, describe, expect, it, beforeEach, afterEach } from 'vitest';

const USER_ID = 'user-1';
const CHAT_ID = 'chat-1';
const RUN_ID = '11111111-2222-4333-8444-555555555555';
const MODEL_ID = 'model-new';
const DATE = new Date('2026-08-25T04:13:39.795Z');

const model: SystemModelCatalogEntry = {
  id: MODEL_ID,
  source: 'system',
  contextWindowTokens: 128_000,
  provider: 'openai',
  providerModelId: 'gpt-test',
  systemPromptTemplate: 'You are a test assistant.',
  systemPromptSource: 'project_default',
};

const unavailableManifest: ToolAvailabilityManifestV1 = {
  version: 1,
  entries: [
    {
      id: 'mcp__docs__lookup',
      state: 'unavailable',
      reason: 'source_disconnected',
    },
  ],
};

const unavailableCandidate: TurnToolCandidate = {
  source: { type: 'mcp', serverId: 'docs' },
  state: 'unavailable',
  id: 'mcp__docs__lookup',
  classification: 'read_only',
  reason: 'source_disconnected',
};

const availableCandidate: TurnToolCandidate = {
  source: { type: 'mcp', serverId: 'docs' },
  state: 'available',
  tool: {
    id: 'mcp__docs__lookup',
    description: 'Look up docs.',
    classification: 'read_only',
    inputSchema: z.object({}),
    execute: () => ({ status: 'success' }),
  },
};

const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: CHAT_ID,
  ownerUserId: USER_ID,
  title: null,
  visibility: 'private',
  createdAt: DATE,
  updatedAt: DATE,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  ...overrides,
});

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-previous',
  chatId: CHAT_ID,
  messageId: 'message-previous',
  userId: USER_ID,
  modelId: 'model-old',
  modelContextSnapshotId: 'snapshot-previous',
  status: 'completed',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: new Date('2026-08-25T04:10:00.000Z'),
  startedAt: null,
  finishedAt: new Date('2026-08-25T04:11:00.000Z'),
  effort: null,
  ...overrides,
});

const snapshot = (
  overrides: Partial<ModelContextSnapshot> = {},
): ModelContextSnapshot => ({
  id: 'snapshot-previous',
  ownerUserId: USER_ID,
  contentHash: 'previous-content',
  availabilityHash: 'previous-availability',
  promptHash: 'previous-prompt',
  toolHash: 'previous-tools',
  source: 'project_default',
  systemPrompt: 'Previous prompt',
  toolAvailabilityManifest: unavailableManifest,
  toolDeclarations: [],
  createdAt: new Date('2026-08-25T04:09:00.000Z'),
  ...overrides,
});

const compaction = (overrides: Partial<Compaction> = {}): Compaction => ({
  id: 'compaction-1',
  chatId: CHAT_ID,
  uptoSeq: 4,
  parentId: null,
  summary: 'Compacted history',
  replacementHistory: [],
  usage: null,
  createdAt: new Date('2026-08-25T04:12:00.000Z'),
  ...overrides,
});

const turnInput = (
  overrides: Partial<PersistUserMessageAndRunInput> = {},
): PersistUserMessageAndRunInput => ({
  chatId: CHAT_ID,
  userId: USER_ID,
  modelId: MODEL_ID,
  effort: undefined,
  message: { id: 'message-current', parts: [{ type: 'text', text: 'hello' }] },
  targetRunId: RUN_ID,
  model,
  user: {},
  allowedToolRules: [unavailableCandidate.id],
  dynamicCandidates: [unavailableCandidate],
  ...overrides,
});

const digestCandidate: RecencyDigestResolution = {
  baseline: {
    pinned: [],
    recent: [
      {
        title: 'Another chat',
        date: '2026-08-24',
        messageCount: 2,
        excerpt: 'Earlier work',
      },
    ],
    pinnedShown: 0,
    pinnedTotal: 0,
    recentShown: 1,
    recentTotal: 1,
    compiledOn: '2026-08-25',
  },
  told: [
    {
      chatId: 'told-chat',
      pinned: false,
      title: 'Told chat',
    },
  ],
  candidates: [],
};

const digestDelta: RecencyDigestDelta = {
  entries: [
    {
      title: 'New chat',
      date: '2026-08-25',
      messageCount: 1,
      pinned: false,
    },
  ],
  pinChanges: [{ title: 'Told chat', pinned: true }],
  told: digestCandidate.told,
};

const contextProducers = (parts: Array<MessagePart>): Array<string> =>
  parts.flatMap((part) =>
    isContextItemPart(part) ? [part.data.producer] : [],
  );

const deps = (): TurnContextDeps => ({
  logger: new Logger('turn-context-test'),
  systemPrompts: { render: vi.fn(() => 'Rendered test prompt') },
  instanceConfig: {
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: { ...BUILT_IN_DEFAULTS.tools, callTimeoutSeconds: 30 },
    },
  },
  knowledgeCandidates: {
    resolve: vi.fn(
      (): Promise<Array<TurnToolCandidate>> => Promise.resolve([]),
    ),
  },
  memory: {
    getForOwnerForBinding: vi.fn(() =>
      Promise.resolve({ shareRecentChats: false }),
    ),
  },
});

// SAFETY: repository methods are replaced before each call; no DB operation reads this value.
// eslint-disable-next-line typescript/no-unsafe-type-assertion
const tx = {} as Db;

const installRepositorySpies = () => ({
  findLatest: vi
    .spyOn(CompactionsRepository.prototype, 'findLatestByChatId')
    .mockResolvedValue(undefined),
  findPrevious: vi
    .spyOn(RunsRepository.prototype, 'findMostRecentByChatMessageSequence')
    .mockResolvedValue(undefined),
  findSnapshot: vi
    .spyOn(ModelContextSnapshotsRepository.prototype, 'findByOwnedRun')
    .mockResolvedValue(undefined),
  setBaseline: vi
    .spyOn(ChatsRepository.prototype, 'setRecencyDigestIfAbsent')
    .mockResolvedValue(undefined),
  findById: vi
    .spyOn(ChatsRepository.prototype, 'findById')
    .mockResolvedValue(undefined),
  findPinned: vi
    .spyOn(ChatsRepository.prototype, 'findPinnedChatIds')
    .mockResolvedValue(new Set()),
});

type RepositorySpies = ReturnType<typeof installRepositorySpies>;
let repositories: RepositorySpies;

describe('buildTurnContextAndParts', () => {
  beforeEach(() => {
    repositories = installRepositorySpies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a first-turn context from chat creation time and emits unavailable tools before time', async () => {
    const input = turnInput();
    const result = await buildTurnContextAndParts(deps(), {
      tx,
      chat: chat(),
      turnInput: input,
      shareRecentChats: { shareRecentChats: false },
      digestDelta: null,
    });

    expect(result.effectiveContext.systemPrompt).toBe('Rendered test prompt');
    expect(result.effectiveContext.toolAvailabilityManifest).toEqual(
      unavailableManifest,
    );
    expect(contextProducers(result.messageParts)).toEqual([
      'tool-availability',
      'temporal',
    ]);
    expect(result.messageParts.at(-1)).toEqual(input.message.parts[0]);
    expect(repositories.findLatest).toHaveBeenCalledWith(CHAT_ID, USER_ID);
    expect(repositories.findPrevious).toHaveBeenCalledWith(CHAT_ID, USER_ID);
  });

  it('uses the prior snapshot epoch and orders model, tool, digest, and temporal disclosures', async () => {
    const activeCompaction = compaction();
    const previousRun = run();
    const previousSnapshot = snapshot();
    repositories.findLatest.mockResolvedValue(activeCompaction);
    repositories.findPrevious.mockResolvedValue(previousRun);
    repositories.findSnapshot.mockResolvedValue(previousSnapshot);

    const result = await buildTurnContextAndParts(deps(), {
      tx,
      chat: chat({
        recencyDigestBaseline: digestCandidate.baseline,
        recencyDigestRebakedFrom: activeCompaction.id,
      }),
      turnInput: turnInput({ dynamicCandidates: [availableCandidate] }),
      shareRecentChats: { shareRecentChats: true },
      digestDelta,
    });

    expect(contextProducers(result.messageParts)).toEqual([
      'effective-context-change',
      'recency-digest',
      'recency-digest',
      'temporal',
    ]);
    expect(result.messageParts.at(-1)).toMatchObject({
      type: 'text',
      text: 'hello',
    });
    expect(repositories.findSnapshot).toHaveBeenCalledWith(
      previousRun.id,
      USER_ID,
    );
  });

  it('continues a prior epoch without disclosures when the model and manifest are unchanged', async () => {
    const previousRun = run({ modelId: MODEL_ID });
    const previousSnapshot = snapshot({
      toolAvailabilityManifest: unavailableManifest,
    });
    repositories.findPrevious.mockResolvedValue(previousRun);
    repositories.findSnapshot.mockResolvedValue(previousSnapshot);

    const result = await buildTurnContextAndParts(deps(), {
      tx,
      chat: chat(),
      turnInput: turnInput({ dynamicCandidates: [unavailableCandidate] }),
      shareRecentChats: { shareRecentChats: false },
      digestDelta: null,
    });

    expect(contextProducers(result.messageParts)).toEqual(['temporal']);
  });

  it('rethrows a prompt render error without a bound digest and redacts it with a bound digest', async () => {
    const originalError = new Error('prompt contains private detail');
    const firstDeps = deps();
    vi.mocked(firstDeps.systemPrompts.render).mockImplementation(() => {
      throw originalError;
    });

    await expect(
      buildTurnContextAndParts(firstDeps, {
        tx,
        chat: chat(),
        turnInput: turnInput(),
        shareRecentChats: { shareRecentChats: false },
        digestDelta: null,
      }),
    ).rejects.toBe(originalError);

    const secondDeps = deps();
    const errorSpy = vi.spyOn(secondDeps.logger, 'error');
    vi.mocked(secondDeps.systemPrompts.render).mockImplementation(() => {
      throw originalError;
    });

    await expect(
      buildTurnContextAndParts(secondDeps, {
        tx,
        chat: chat({ recencyDigestBaseline: digestCandidate.baseline }),
        turnInput: turnInput(),
        shareRecentChats: { shareRecentChats: true },
        digestDelta: null,
      }),
    ).rejects.toThrow('Failed to render system prompt');
    expect(errorSpy).toHaveBeenCalledWith('recency_digest_render_failed');
  });
});

describe('resolveTurnContext', () => {
  beforeEach(() => {
    repositories = installRepositorySpies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds a first digest candidate only when consent is still true', async () => {
    const turnDeps = deps();
    vi.mocked(turnDeps.memory.getForOwnerForBinding).mockResolvedValue({
      shareRecentChats: true,
    });
    const binding = chat({
      recencyDigestBaseline: digestCandidate.baseline,
      recencyDigestTold: digestCandidate.told,
    });
    repositories.setBaseline.mockResolvedValue(binding);
    const input = turnInput({ digestCandidate });

    const result = await resolveTurnContext(
      turnDeps,
      { tx, chatsRepo: new ChatsRepository(tx), chat: chat() },
      input,
    );

    expect(turnDeps.memory.getForOwnerForBinding).toHaveBeenCalledWith(
      tx,
      USER_ID,
    );
    expect(repositories.setBaseline).toHaveBeenCalledWith(
      CHAT_ID,
      USER_ID,
      digestCandidate.baseline,
      digestCandidate.told,
    );
    expect(repositories.findById).not.toHaveBeenCalled();
    expect(result.digestDelta).toBeNull();
  });

  it('falls back to a read when the first digest binding loses the race', async () => {
    const turnDeps = deps();
    vi.mocked(turnDeps.memory.getForOwnerForBinding).mockResolvedValue({
      shareRecentChats: true,
    });
    repositories.setBaseline.mockResolvedValue(undefined);
    repositories.findById.mockResolvedValue(
      chat({
        recencyDigestBaseline: digestCandidate.baseline,
        recencyDigestTold: digestCandidate.told,
      }),
    );

    await resolveTurnContext(
      turnDeps,
      { tx, chatsRepo: new ChatsRepository(tx), chat: chat() },
      turnInput({ digestCandidate }),
    );

    expect(repositories.findById).toHaveBeenCalledWith(CHAT_ID, USER_ID);
  });

  it('derives a digest delta only for an existing shared baseline and reads current pins', async () => {
    const turnDeps = deps();
    vi.mocked(turnDeps.memory.getForOwnerForBinding).mockResolvedValue({
      shareRecentChats: true,
    });
    const existing = chat({
      recencyDigestBaseline: digestCandidate.baseline,
      recencyDigestTold: digestCandidate.told,
    });
    repositories.findPinned.mockResolvedValue(new Set(['told-chat']));

    const result = await resolveTurnContext(
      turnDeps,
      { tx, chatsRepo: new ChatsRepository(tx), chat: existing },
      turnInput({ digestCandidate }),
    );

    expect(repositories.findPinned).toHaveBeenCalledWith(USER_ID, [
      'told-chat',
    ]);
    expect(result.digestDelta).toMatchObject({
      entries: [],
      pinChanges: [{ title: 'Told chat', pinned: true }],
    });
  });

  it('does not bind or diff a candidate after consent is withdrawn', async () => {
    const turnDeps = deps();
    const result = await resolveTurnContext(
      turnDeps,
      {
        tx,
        chatsRepo: new ChatsRepository(tx),
        chat: chat({ recencyDigestBaseline: digestCandidate.baseline }),
      },
      turnInput({ digestCandidate }),
    );

    expect(repositories.setBaseline).not.toHaveBeenCalled();
    expect(repositories.findPinned).not.toHaveBeenCalled();
    expect(result.digestDelta).toBeNull();
  });
});
