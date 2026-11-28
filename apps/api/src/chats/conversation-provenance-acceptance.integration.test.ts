/**
 * Conversation provenance acceptance through the real queued-run path.
 *
 * This is deliberately one cross-layer proof rather than another collection
 * of matcher/reader unit tests: a real pg-boss job runs the real executor,
 * lexical search, canonical hydration, conversation reader, durable events,
 * and message settlement against Postgres. Browser reload and message-target
 * navigation are covered by the companion product e2e; the giant fixture
 * stays here so Playwright does not become a database-row authoring harness.
 */

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { waitFor } from '../testing/support';
import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from '../runs/worker-harness';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { nativeReadTool } from '../tools/native-files';
import { SearchIndexService } from '../search/search-index.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'TEST_DATABASE_URL is required for conversation provenance acceptance',
  );
}

vi.setConfig({ testTimeout: 120_000 });

const SEARCH_QUERY = 'episodic acceptance marker';
const FOREIGN_QUERY = 'foreign owner episodic marker';
const RETRYABLE_MARKER = 'retryable assistant must never become evidence';
const CONVERSATION_TOOLS = ['search_conversations', 'read'];

const canonicalContentResultSchema = z.object({
  kind: z.literal('content'),
  chatId: z.guid(),
  messageSeq: z.number().int().positive().safe(),
  locator: z.string(),
  excerpt: z.string(),
});

const searchToolPartSchema = z.object({
  type: z.literal('tool-search_conversations'),
  output: z.object({
    status: z.literal('success'),
    results: z.array(canonicalContentResultSchema),
  }),
});

const readToolPartSchema = z.object({
  type: z.literal('tool-read'),
  input: z.object({ path: z.string() }),
  output: z.object({
    status: z.literal('success'),
    kind: z.literal('file'),
    path: z.string(),
    representation: z.enum(['text', 'raw']),
    chatId: z.guid(),
    messageSeq: z.number().int().positive().safe(),
    content: z.string(),
    lineCount: z.number().int().nonnegative(),
    continuationLocator: z.string().optional(),
  }),
});

const toolEventPayloadSchema = z.object({ toolName: z.string() });

type SourcePart =
  | { type: 'text' | 'reasoning'; text: string }
  | { type: 'tool-call'; toolName: string; input: { secret: boolean } };

function searchToolPart(parts: ReadonlyArray<unknown>) {
  for (const part of parts) {
    const parsed = searchToolPartSchema.safeParse(part);

    if (parsed.success) return parsed.data;
  }

  return undefined;
}

function readToolParts(parts: ReadonlyArray<unknown>) {
  return parts.flatMap((part) => {
    const parsed = readToolPartSchema.safeParse(part);

    const candidate = z
      .object({ type: z.literal('tool-read') })
      .safeParse(part);

    if (candidate.success && !parsed.success) {
      throw new Error(`Invalid persisted read output: ${parsed.error.message}`);
    }

    return parsed.success ? [parsed.data] : [];
  });
}

describe('conversation provenance acceptance — queued lexical search and canonical read', () => {
  let harness: WorkerHarness;
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    harness = await bootWorkerHarness({
      allowedTools: CONVERSATION_TOOLS,
      runsConcurrency: 2,
    });
    ownerA = await createUser(harness.db, 'conversation-acceptance-a');
    ownerB = await createUser(harness.db, 'conversation-acceptance-b');
  });

  afterAll(async () => {
    await harness?.close();
  });

  const runStatus = (runId: string, userId: string) =>
    harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );

  const runEvents = (runId: string, userId: string) =>
    harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );

  async function seedSource(
    ownerUserId: string,
    title: string,
    parts: ReadonlyArray<SourcePart>,
    options: {
      role?: 'user' | 'assistant';
      usage?: { status: 'error' };
    } = {},
  ) {
    const { role = 'user', usage } = options;
    const chatId = crypto.randomUUID();

    const message = await harness.tenantDb.runAs(ownerUserId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId,
        title,
      });

      return new MessagesRepository(tx).create({
        chatId,
        role,
        senderUserId: role === 'user' ? ownerUserId : null,
        parts: [...parts],
        ...(usage !== undefined && { usage }),
      });
    });

    return { chatId, message };
  }

  async function removeChat(ownerUserId: string, chatId: string) {
    await harness.tenantDb.runAs(ownerUserId, (tx) =>
      tx.execute(sql`DELETE FROM chats WHERE id = ${chatId}`),
    );
  }

  function readAs(userId: string, chatId: string, path: string) {
    return nativeReadTool.execute(
      { userId, chatId, tenantDb: harness.tenantDb, configuredCredentials: [] },
      { path },
    );
  }

  it('executes queued search → exact native read and preserves the observation after source deletion', async () => {
    const sourceLines = Array.from({ length: 2050 }, (_, index) =>
      index === 137
        ? `${SEARCH_QUERY} 😀 source line`
        : `source line ${index.toString().padStart(4, '0')}`,
    );

    const source = await seedSource(ownerA, 'Episodic acceptance source', [
      {
        type: 'text',
        text: `opening source\r\n${sourceLines.slice(0, 700).join('\r\n')}`,
      },
      { type: 'reasoning', text: 'reasoning must never enter evidence' },
      {
        type: 'text',
        text: `${sourceLines.slice(700).join('\r\n')}\r\nterminal source`,
      },
      { type: 'tool-call', toolName: 'hidden_tool', input: { secret: true } },
      { type: 'text', text: 'final visible part' },
    ]);

    await new SearchIndexService(harness.tenantDb).reindexChat(
      source.chatId,
      ownerA,
    );

    const modelId = `conversation-recall-${Date.now()}`;
    harness.models.register(modelId, {
      kind: 'conversation-recall',
      query: SEARCH_QUERY,
      continueRead: false,
      finalText: 'The canonical source was read.',
    });

    const target = await seedAndDispatchRun(harness, {
      userId: ownerA,
      modelId,
      text: 'Recall the episodic acceptance source.',
    });

    const completed = await waitFor(
      async () => {
        const run = await runStatus(target.runId, ownerA);

        return run?.status === 'completed' ? run : undefined;
      },
      30_000,
      'the queued search and read run to complete',
    );

    expect(completed.status).toBe('completed');

    const messages = await harness.tenantDb.runAs(ownerA, (tx) =>
      new MessagesRepository(tx).findByChatId(target.chatId, ownerA),
    );

    const assistant = messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.inReplyTo === target.userMessage.id,
    );

    if (!assistant) throw new Error('Expected persisted assistant reply');

    const search = searchToolPart(assistant.parts);

    if (!search) throw new Error('Expected persisted search tool output');
    const contentResult = search.output.results[0];

    if (!contentResult) {
      throw new Error('Expected a canonical content search result');
    }

    expect(contentResult).toMatchObject({
      chatId: source.chatId,
      messageSeq: source.message.seq,
      kind: 'content',
    });
    expect(contentResult.locator).toMatch(
      new RegExp(
        `^chat://${source.chatId}/${source.message.seq}:L\\d+-\\d+$`,
        'u',
      ),
    );
    expect(contentResult.excerpt).toEqual(
      expect.stringContaining(SEARCH_QUERY),
    );
    expect(JSON.stringify(contentResult)).not.toContain('reasoning must never');
    expect(JSON.stringify(contentResult)).not.toContain('hidden_tool');

    const readParts = readToolParts(assistant.parts);

    if (readParts.length !== 1) {
      const partTypes = assistant.parts.flatMap((part) => {
        const parsed = z.object({ type: z.string() }).safeParse(part);

        return parsed.success ? [parsed.data.type] : [];
      });

      throw new Error(
        `Expected one persisted native read, found: ${partTypes.join(', ')}`,
      );
    }

    const firstRead = readParts[0];

    if (!firstRead) throw new Error('Expected one persisted read output');
    const firstReadOutput = firstRead.output;
    expect(firstRead.input.path).toBe(contentResult.locator);
    expect(firstReadOutput).toMatchObject({
      status: 'success',
      kind: 'file',
      path: `chat://${source.chatId}/${source.message.seq}`,
      chatId: source.chatId,
      messageSeq: source.message.seq,
    });
    expect(firstReadOutput.content).toMatch(/^\d+: /u);
    expect(firstReadOutput.content).toContain(SEARCH_QUERY);
    expect(firstReadOutput.content).not.toContain(
      'reasoning must never enter evidence',
    );

    const events = await runEvents(target.runId, ownerA);
    expect(
      events
        .filter((event) => event.eventType === 'tool.completed')
        .map((event) => toolEventPayloadSchema.parse(event.payload).toolName),
    ).toEqual(['search_conversations', 'read']);
    expect(
      events.filter((event) => event.eventType === 'tool.requested'),
    ).toHaveLength(2);

    const persistedObservations = JSON.stringify(
      readParts.map((part) => part.output),
    );

    await removeChat(ownerA, source.chatId);

    await expect(
      readAs(ownerA, target.chatId, contentResult.locator),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'not_found',
    });

    const afterDeletion = await harness.tenantDb.runAs(ownerA, (tx) =>
      new MessagesRepository(tx).findByChatId(target.chatId, ownerA),
    );

    const afterAssistant = afterDeletion.find(
      (message) =>
        message.role === 'assistant' &&
        message.inReplyTo === target.userMessage.id,
    );

    const persistedAfterDeletion = readToolParts(afterAssistant?.parts ?? []);

    if (persistedAfterDeletion.length !== 1) {
      throw new Error('Expected the native read after source deletion');
    }

    expect(
      JSON.stringify(persistedAfterDeletion.map((part) => part.output)),
    ).toBe(persistedObservations);

    await removeChat(ownerA, target.chatId);
  });

  it('keeps search and read closed across tenants and omits retryable assistant bytes', async () => {
    const foreign = await seedSource(ownerB, 'Foreign and retryable source', [
      { type: 'text', text: `${FOREIGN_QUERY} foreign owner source` },
    ]);

    const retryable = await seedSource(
      ownerB,
      'Retryable source',
      [{ type: 'text', text: RETRYABLE_MARKER }],
      { role: 'assistant', usage: { status: 'error' } },
    );

    await new SearchIndexService(harness.tenantDb).reindexChat(
      foreign.chatId,
      ownerB,
    );
    await new SearchIndexService(harness.tenantDb).reindexChat(
      retryable.chatId,
      ownerB,
    );

    const modelId = `cross-tenant-search-${Date.now()}`;
    harness.models.register(modelId, {
      kind: 'conversation-recall',
      query: FOREIGN_QUERY,
      finalText: 'No owner-authorized source was available.',
    });

    const target = await seedAndDispatchRun(harness, {
      userId: ownerA,
      modelId,
      text: 'Search only my own history.',
    });

    await waitFor(
      async () =>
        (await runStatus(target.runId, ownerA))?.status === 'completed'
          ? true
          : undefined,
      30_000,
      'the cross-tenant search run to complete',
    );

    const targetMessages = await harness.tenantDb.runAs(ownerA, (tx) =>
      new MessagesRepository(tx).findByChatId(target.chatId, ownerA),
    );

    const targetAssistant = targetMessages.find(
      (message) => message.role === 'assistant',
    );

    const search = searchToolPart(targetAssistant?.parts ?? []);

    if (!search) throw new Error('Expected cross-tenant search output');
    expect(search.output.results).toEqual([]);
    expect(JSON.stringify(search.output)).not.toContain('foreign owner source');

    await expect(
      readAs(
        ownerA,
        target.chatId,
        `chat://${foreign.chatId}/${foreign.message.seq}`,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'not_found',
    });
    await expect(
      readAs(
        ownerB,
        retryable.chatId,
        `chat://${retryable.chatId}/${retryable.message.seq}`,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'not_found',
    });

    const retryableSearchModelId = `retryable-search-${Date.now()}`;
    harness.models.register(retryableSearchModelId, {
      kind: 'conversation-recall',
      query: RETRYABLE_MARKER,
      finalText: 'No retryable source was available.',
    });

    const retryableSearch = await seedAndDispatchRun(harness, {
      userId: ownerB,
      modelId: retryableSearchModelId,
      text: 'Search my history for retryable assistant content.',
    });

    await waitFor(
      async () =>
        (await runStatus(retryableSearch.runId, ownerB))?.status === 'completed'
          ? true
          : undefined,
      30_000,
      'the retryable-source search run to complete',
    );

    const retryableSearchMessages = await harness.tenantDb.runAs(ownerB, (tx) =>
      new MessagesRepository(tx).findByChatId(retryableSearch.chatId, ownerB),
    );

    const retryableSearchAssistant = retryableSearchMessages.find(
      (message) => message.role === 'assistant',
    );

    const retryableSearchOutput = searchToolPart(
      retryableSearchAssistant?.parts ?? [],
    )?.output;

    if (!retryableSearchOutput) {
      throw new Error('Expected retryable-source search output');
    }

    expect(retryableSearchOutput.results).toEqual([]);
    expect(JSON.stringify(retryableSearchOutput)).not.toContain(
      RETRYABLE_MARKER,
    );

    await removeChat(ownerB, foreign.chatId);
    await removeChat(ownerB, retryable.chatId);
    await removeChat(ownerA, target.chatId);
    await removeChat(ownerB, retryableSearch.chatId);
  });

  it('settles a queued cancellation through the existing worker runner path', async () => {
    const modelId = `conversation-cancel-${Date.now()}`;
    harness.models.register(modelId, { kind: 'hang' });

    const seed = await seedAndDispatchRun(harness, {
      userId: ownerA,
      modelId,
      text: 'Cancel this conversation read run.',
    });

    await waitFor(
      async () =>
        (await runStatus(seed.runId, ownerA))?.status === 'running_model'
          ? true
          : undefined,
      15_000,
      'the cancellation run to reach the model',
    );
    await harness.tenantDb.runAs(ownerA, (tx) =>
      new RunsRepository(tx).requestCancel(seed.runId, ownerA),
    );

    await waitFor(
      async () =>
        (await runStatus(seed.runId, ownerA))?.status === 'cancelled'
          ? true
          : undefined,
      15_000,
      'the queued run to settle as cancelled',
    );
    await removeChat(ownerA, seed.chatId);
  });
});
