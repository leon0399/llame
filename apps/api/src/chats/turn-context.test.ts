import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type {
  ToolAvailabilityManifestV1,
  TurnToolCandidate,
} from '../tools/turn-tool-catalog';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import type { SystemPromptRenderInput } from '../system-prompts/system-prompts.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { Db } from '../db/tenant-db.service';
import type { Chat, Compaction, ModelContextSnapshot, Run } from '../db/schema';
import { ChatsRepository, CompactionsRepository } from './chats-repository';
import {
  SkillCatalog,
  type SkillCatalogEntry,
  type SkillCatalogPort,
} from '../skills/skill-catalog';
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
import { isContextItemPart, type ContextItemPart } from './context-item';
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
  referencesSkills: false,
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
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
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
  skillCatalog: new SkillCatalog([]),
});

/** The same deps with a configured (non-empty) skill source and a catalog. */
const skillDeps = (
  entries: ReadonlyArray<SkillCatalogEntry>,
): TurnContextDeps => ({
  ...deps(),
  // Keeps deps()'s tool settings so only the skill source differs.
  instanceConfig: {
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: { ...BUILT_IN_DEFAULTS.tools, callTimeoutSeconds: 30 },
      skills: { directories: ['/opt/skills'] },
    },
  },
  skillCatalog: catalogOf(entries),
});

const catalogOf = (
  entries: ReadonlyArray<SkillCatalogEntry>,
): SkillCatalogPort => {
  const catalog = new SkillCatalog([]);
  vi.spyOn(catalog, 'getSnapshot').mockReturnValue({
    available: true,
    directories: ['/opt/skills'],
    entries: [...entries],
    diagnostics: [],
  });
  return catalog;
};

const skillEntry = (
  name: string,
  description: string | null,
  overrides: Partial<SkillCatalogEntry> = {},
): SkillCatalogEntry => ({
  name,
  description,
  proactive: true,
  sourceDirectory: '/opt/skills',
  skillDirectory: `/opt/skills/${name}`,
  available: true,
  diagnostics: [],
  ...overrides,
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
  setSkillBaseline: vi
    .spyOn(ChatsRepository.prototype, 'setSkillCatalogBaseline')
    .mockResolvedValue(undefined),
  setSkillTold: vi
    .spyOn(ChatsRepository.prototype, 'updateSkillCatalogTold')
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

describe('the frozen skill-catalog baseline', () => {
  beforeEach(() => {
    repositories = installRepositorySpies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const build = (input: {
    deps: TurnContextDeps;
    chat?: Chat;
    anchorCompaction?: Compaction;
  }) => {
    repositories.findLatest.mockResolvedValue(input.anchorCompaction);
    return buildTurnContextAndParts(input.deps, {
      tx,
      chat: input.chat ?? chat(),
      turnInput: turnInput(),
      shareRecentChats: { shareRecentChats: false },
      digestDelta: null,
    });
  };

  it('writes no column when no skill source is configured', async () => {
    await build({ deps: deps() });

    expect(repositories.setSkillBaseline).not.toHaveBeenCalled();
  });

  it('resolves the current catalog into the prompt and freezes it on the chat', async () => {
    const rendered = vi.fn(
      (_input: SystemPromptRenderInput) => 'Rendered test prompt',
    );
    const context = skillDeps([
      skillEntry('pdf', 'Extract text'),
      skillEntry('review', 'Review', { proactive: false }),
      skillEntry('broken', null, { available: false }),
    ]);
    context.systemPrompts = { render: rendered };

    await build({ deps: context });

    // Only the proactively eligible, readable package reaches the projection.
    expect(rendered).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: {
          entries: [{ name: 'pdf', description: 'Extract text' }],
          omitted: 0,
        },
      }),
    );
    expect(repositories.setSkillBaseline).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      ownerUserId: USER_ID,
      baseline: {
        entries: [{ name: 'pdf', description: 'Extract text' }],
        omitted: 0,
      },
      rebakedFrom: null,
    });
  });

  it('passes an empty baseline through when the catalog admits nothing', async () => {
    const rendered = vi.fn(
      (_input: SystemPromptRenderInput) => 'Rendered test prompt',
    );
    const context = skillDeps([
      skillEntry('review', 'Review', { proactive: false }),
    ]);
    context.systemPrompts = { render: rendered };

    await build({ deps: context });

    // The KEY is present here as an empty-but-defined object: `skillBaseline` is
    // defined, so this layer forwards it. The gate is decided one layer deeper,
    // in the prompt loader's `skillsContext`, where zero entries makes `skills`
    // absent from the Handlebars context — which is what makes the default
    // template's `{{#if skills}}` omit the whole section.
    expect(rendered.mock.calls[0][0].skills).toEqual({
      entries: [],
      omitted: 0,
    });
    expect(repositories.setSkillBaseline).toHaveBeenCalled();
  });

  it('reuses a stored baseline within the same compaction epoch', async () => {
    const stored = {
      entries: [{ name: 'stored', description: 'From the baseline' }],
      omitted: 2,
    };
    const rendered = vi.fn(
      (_input: SystemPromptRenderInput) => 'Rendered test prompt',
    );
    const context = skillDeps([skillEntry('pdf', 'Fresh')]);
    context.systemPrompts = { render: rendered };
    // The catalog would resolve differently, so a live read would be visible.
    repositories.findLatest.mockResolvedValue(
      compaction({ id: 'compaction-1' }),
    );

    await buildTurnContextAndParts(context, {
      tx,
      chat: chat({
        skillCatalogBaseline: stored,
        skillCatalogRebakedFrom: 'compaction-1',
      }),
      turnInput: turnInput(),
      shareRecentChats: { shareRecentChats: false },
      digestDelta: null,
    });

    expect(rendered).toHaveBeenCalledWith(
      expect.objectContaining({ skills: stored }),
    );
    expect(repositories.setSkillBaseline).not.toHaveBeenCalled();
  });

  it('re-resolves at the turn after a new compaction starts an epoch', async () => {
    const context = skillDeps([skillEntry('pdf', 'Fresh')]);
    repositories.findLatest.mockResolvedValue(
      compaction({ id: 'compaction-2' }),
    );

    await buildTurnContextAndParts(context, {
      tx,
      chat: chat({
        skillCatalogBaseline: {
          entries: [{ name: 'stale', description: 'Old epoch' }],
          omitted: 0,
        },
        skillCatalogRebakedFrom: 'compaction-1',
      }),
      turnInput: turnInput(),
      shareRecentChats: { shareRecentChats: false },
      digestDelta: null,
    });

    expect(repositories.setSkillBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        baseline: {
          entries: [{ name: 'pdf', description: 'Fresh' }],
          omitted: 0,
        },
        rebakedFrom: 'compaction-2',
      }),
    );
  });

  it('keeps an uncompacted chat on its first baseline', async () => {
    const stored = {
      entries: [{ name: 'stored', description: 'd' }],
      omitted: 0,
    };
    const context = skillDeps([skillEntry('pdf', 'Fresh')]);
    repositories.findLatest.mockResolvedValue(undefined);

    await buildTurnContextAndParts(context, {
      tx,
      chat: chat({
        skillCatalogBaseline: stored,
        skillCatalogRebakedFrom: null,
        skillCatalogTold: null,
      }),
      turnInput: turnInput(),
      shareRecentChats: { shareRecentChats: false },
      digestDelta: null,
    });

    expect(repositories.setSkillBaseline).not.toHaveBeenCalled();
    expect(context.systemPrompts.render).toHaveBeenCalledWith(
      expect.objectContaining({ skills: stored }),
    );
  });

  it('keeps advertising a stored baseline after the source list is emptied', async () => {
    const stored = {
      entries: [{ name: 'stored', description: 'From the baseline' }],
      omitted: 0,
    };
    const rendered = vi.fn((_input: SystemPromptRenderInput) => 'prompt');
    // No configured source now, but the chat holds a baseline for this epoch.
    const context: TurnContextDeps = {
      ...deps(),
      systemPrompts: { render: rendered },
    };
    repositories.findLatest.mockResolvedValue(undefined);

    await buildTurnContextAndParts(context, {
      tx,
      chat: chat({
        skillCatalogBaseline: stored,
        skillCatalogRebakedFrom: null,
        skillCatalogTold: null,
      }),
      turnInput: turnInput(),
      shareRecentChats: { shareRecentChats: false },
      digestDelta: null,
    });

    // Reuse outranks the configured list: dropping the section here would
    // silently unadvertise a catalog the chat is still told about, and removals
    // are announced as notices rather than by mutating the frozen prompt.
    expect(rendered).toHaveBeenCalledWith(
      expect.objectContaining({ skills: stored }),
    );
    expect(repositories.setSkillBaseline).not.toHaveBeenCalled();
  });

  it('writes no baseline for an unconfigured instance with no stored one', async () => {
    repositories.findLatest.mockResolvedValue(undefined);
    const rendered = vi.fn((_input: SystemPromptRenderInput) => 'prompt');
    const context: TurnContextDeps = {
      ...deps(),
      systemPrompts: { render: rendered },
    };

    await buildTurnContextAndParts(context, {
      tx,
      chat: chat(),
      turnInput: turnInput(),
      shareRecentChats: { shareRecentChats: false },
      digestDelta: null,
    });

    // No key at all, which is what leaves the default template's
    // `{{#if skills}}` section unrendered.
    expect(rendered.mock.calls[0][0].skills).toBeUndefined();
    expect(repositories.setSkillBaseline).not.toHaveBeenCalled();
  });

  it('reports an honest omitted count when the bound overflows', async () => {
    const entries = Array.from({ length: 300 }, (_, i) =>
      skillEntry(`s${String(i).padStart(3, '0')}`, 'd'),
    );
    const rendered = vi.fn(
      (_input: SystemPromptRenderInput) => 'Rendered test prompt',
    );
    const context = skillDeps(entries);
    context.systemPrompts = { render: rendered };

    await build({ deps: context });

    const passed = rendered.mock.calls[0][0].skills;
    if (passed === undefined) throw new Error('expected a skills projection');
    expect(passed.entries).toHaveLength(256);
    expect(passed.omitted).toBe(44);
  });
});

describe('the skill-catalog notice', () => {
  beforeEach(() => {
    repositories = installRepositorySpies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildWith = (
    entries: ReadonlyArray<SkillCatalogEntry>,
    chatOverrides: Partial<Chat>,
    options: { readonly referencesSkills?: boolean } = {},
  ) => {
    const rendered = vi.fn((_input: SystemPromptRenderInput) => 'prompt');
    const context = skillDeps(entries);
    context.systemPrompts = { render: rendered };
    const model = {
      ...turnInput().model,
      referencesSkills: options.referencesSkills ?? true,
    };
    return {
      context,
      run: buildTurnContextAndParts(context, {
        tx,
        chat: chat({ ...chatOverrides }),
        turnInput: turnInput({ model }),
        shareRecentChats: { shareRecentChats: false },
        digestDelta: null,
      }),
    };
  };

  function catalogItems(parts: Array<MessagePart>): Array<ContextItemPart> {
    return parts.filter(
      (part): part is ContextItemPart =>
        isContextItemPart(part) && part.data.producer === 'skill-catalog',
    );
  }

  const catalogForms = (parts: Array<MessagePart>): Array<string> =>
    catalogItems(parts).map((part) => part.data.form ?? 'notice');

  it('announces an addition with its current description', async () => {
    const { run } = buildWith(
      [skillEntry('pdf', 'Extract text'), skillEntry('research', 'Plan it')],
      {
        skillCatalogBaseline: {
          entries: [{ name: 'pdf', description: 'Extract text' }],
          omitted: 0,
        },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      },
    );

    const result = await run;
    expect(catalogForms(result.messageParts)).toEqual(['notice']);
    const [item] = catalogItems(result.messageParts);
    expect(item.data.text).toContain('`research`');
    expect(item.data.text).toContain('Plan it');
    expect(item.data.payload).toMatchObject({
      kind: 'delta',
      added: [{ name: 'research', description: 'Plan it' }],
      removed: [],
    });
    // The turn reports the told state it establishes; persisting it belongs to
    // the accepted-turn transaction the caller owns, so this unit asserts the
    // value rather than the write.
    expect(result.skillCatalogTold).toEqual(['pdf', 'research']);
  });

  it('announces a removal by name only', async () => {
    const { run } = buildWith([skillEntry('pdf', 'Extract text')], {
      skillCatalogBaseline: { entries: [], omitted: 0 },
      skillCatalogRebakedFrom: null,
      skillCatalogTold: ['pdf', 'legacy'],
    });

    const result = await run;
    const [item] = catalogItems(result.messageParts);
    expect(item.data.payload).toMatchObject({
      kind: 'delta',
      added: [],
      removed: ['legacy'],
    });
    // A removals-only delta carries no operator text, so no precedence line.
    expect(item.data.text).not.toContain('operator-authored catalog data');
  });

  it('emits nothing when the advertised set is unchanged', async () => {
    const { run } = buildWith([skillEntry('pdf', 'Extract text')], {
      skillCatalogBaseline: {
        entries: [{ name: 'pdf', description: 'Extract text' }],
        omitted: 0,
      },
      skillCatalogRebakedFrom: null,
      skillCatalogTold: ['pdf'],
    });

    const result = await run;
    expect(catalogForms(result.messageParts)).toEqual([]);
    expect(result.skillCatalogTold).toBeUndefined();
  });

  it('emits nothing and leaves the told state alone on an opted-out model', async () => {
    const { run } = buildWith(
      [skillEntry('pdf', 'Extract text'), skillEntry('research', 'Plan it')],
      {
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      },
      { referencesSkills: false },
    );

    const result = await run;
    expect(catalogForms(result.messageParts)).toEqual([]);
    // Untouched, so a later switch to a rendering model announces the addition.
    expect(result.skillCatalogTold).toBeUndefined();
  });

  it('announces the addition after a switch to a rendering model', async () => {
    const { run } = buildWith(
      [skillEntry('pdf', 'Extract text'), skillEntry('research', 'Plan it')],
      {
        skillCatalogBaseline: { entries: [], omitted: 0 },
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      },
      { referencesSkills: true },
    );

    const [item] = catalogItems((await run).messageParts);
    expect(item.data.payload).toMatchObject({
      added: [expect.objectContaining({ name: 'research' })],
    });
  });

  it('starts a new told state at a compaction epoch with no notice', async () => {
    const { run, context } = buildWith([skillEntry('pdf', 'Extract text')], {
      skillCatalogBaseline: {
        entries: [{ name: 'stale', description: 'Old epoch' }],
        omitted: 0,
      },
      skillCatalogRebakedFrom: 'compaction-1',
      skillCatalogTold: ['stale'],
    });
    repositories.findLatest.mockResolvedValue(
      compaction({ id: 'compaction-2' }),
    );

    const result = await run;
    // No delta across the boundary: the baseline is what the model is shown.
    expect(catalogForms(result.messageParts)).toEqual([]);
    // The epoch reset writes the told state directly (it is not a notice), so
    // the turn reports nothing extra to persist.
    expect(result.skillCatalogTold).toBeUndefined();
    expect(repositories.setSkillTold).toHaveBeenCalledWith(CHAT_ID, USER_ID, [
      'pdf',
    ]);
    expect(context.systemPrompts.render).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: {
          entries: [{ name: 'pdf', description: 'Extract text' }],
          omitted: 0,
        },
      }),
    );
  });

  it('adopts the baseline as told state when none was recorded', async () => {
    // A chat whose baseline predates this layer was still shown the catalog by
    // its prompt, so adopting it emits no duplicate notice.
    const { run } = buildWith([skillEntry('pdf', 'Extract text')], {
      skillCatalogBaseline: {
        entries: [{ name: 'pdf', description: 'Extract text' }],
        omitted: 0,
      },
      skillCatalogRebakedFrom: null,
      skillCatalogTold: null,
    });

    expect(catalogForms((await run).messageParts)).toEqual([]);
  });

  it('supersedes with a snapshot when the delta cannot fit the bound', async () => {
    // 300 removals plus one addition is past the 256-entry bound, so the delta
    // cannot be rendered honestly and the bounded current set replaces it.
    const told = Array.from(
      { length: 300 },
      (_, i) => `gone-${String(i).padStart(3, '0')}`,
    );
    const { run } = buildWith([skillEntry('pdf', 'Extract text')], {
      skillCatalogBaseline: { entries: [], omitted: 0 },
      skillCatalogRebakedFrom: null,
      skillCatalogTold: told,
    });

    const result = await run;
    const [item] = catalogItems(result.messageParts);
    expect(item.data.form).toBe('snapshot');
    expect(item.data.text).toContain('superseded');
    expect(item.data.payload).toMatchObject({ kind: 'snapshot', omitted: 0 });
    // The told state becomes the snapshot's admitted set, not the delta's.
    expect(result.skillCatalogTold).toEqual(['pdf']);
  });

  it('supersedes when the delta exceeds the byte bound', async () => {
    // Names come out of the told state and are not themselves bounded, so a
    // large told set alongside a large advertised entry overflows on bytes.
    const told = Array.from(
      { length: 200 },
      (_, i) => `${'g'.repeat(60)}-${i}`,
    );
    const { run } = buildWith([skillEntry('pdf', 'x'.repeat(15 * 1024))], {
      skillCatalogBaseline: { entries: [], omitted: 0 },
      skillCatalogRebakedFrom: null,
      skillCatalogTold: told,
    });

    const [item] = catalogItems((await run).messageParts);
    expect(item.data.form).toBe('snapshot');
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
