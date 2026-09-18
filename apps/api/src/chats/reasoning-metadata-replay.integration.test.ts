/**
 * Reasoning provider metadata across a worker restart (design D15/D17, task 3.3).
 *
 * A worker that dies mid-turn leaves the turn's reasoning — and the opaque
 * provider metadata bound to it — durably in the run's event log. Settling that
 * run reconstructs the assistant message from those events, and the NEXT Run for
 * the chat (a fresh service instance stands in for the restarted worker)
 * rebuilds its request from the persisted parts. That first request must carry
 * the earlier reasoning part with its metadata and unmodified text, ahead of the
 * content the same turn produced.
 *
 * The second consequence of the same rule: provider metadata is only ever
 * durable BOUND to a persisted reasoning part. Nothing else in the chat
 * transcript may carry it once the run is terminal.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { streamText } from 'ai';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import type { ModelSelectionValidator } from '../models/models.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import type { KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import { TOOL_REGISTRY } from '../tools/registry';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { isTextPart } from './context-builder';
import { isRecord } from '@workspace/runtime-safety';
import { MemoryService } from '../memory/memory.service';
import { RecencyDigestService } from './recency-digest.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import type { CompactionCapability } from '../compaction/compaction.service';
import type { TitleCapability } from '../titles/title.service';
import { RunExecutionService } from '../runs/run-execution.service';
import { noopSkillCatalog } from '../skills/skill-catalog.stub';
import { type KnowledgeToolResolver } from '../tools/types';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { SearchIndexService } from '../search/search-index.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = Sql;

const MODEL_ID = 'system:openai:gpt-5.4-mini';
/** The opaque values the adapter produced; llame must carry them untouched. */
const REASONING_TEXT = 'reasoning before the tool call';
const PROVIDER_METADATA = {
  openai: {
    itemId: 'rs-resumed-1',
    reasoningEncryptedContent: 'ENCRYPTED_RESUMED',
  },
};
/** Opaque metadata with no persisted reasoning part to belong to. */
const ORPHAN_PROVIDER_METADATA = {
  openai: {
    itemId: 'rs-orphan-1',
    reasoningEncryptedContent: 'ENCRYPTED_ORPHAN',
  },
};

const knowledgeResolver: KnowledgeToolResolver = {
  listForOwnerPage: () => Promise.resolve({ spaces: [] }),
  resolveBindingForOwnerById: () => Promise.resolve(undefined),
  createAdapter: () => ({
    search: () => Promise.resolve([]),
    resolveHostPath: () =>
      Promise.reject(new Error('Knowledge adapter is not exercised')),
    isInsideSpace: () => Promise.resolve(true),
  }),
};

const testModelEntry: SystemModelCatalogEntry = {
  id: 'mock',
  source: 'system',
  contextWindowTokens: 128_000,
  provider: 'mock',
  providerModelId: 'mock',
  systemPromptTemplate: 'Test prompt: default',
  systemPromptSource: 'project_default',
  referencesSkills: false,
};

const models: ModelSelectionValidator = {
  validateModelSelection: () => testModelEntry,
  resolveEffortSelection: () => undefined,
};

const knowledgeCandidates: KnowledgeToolCandidateResolverPort = {
  resolve: () =>
    Promise.resolve(
      [...TOOL_REGISTRY.values()].map((tool) => ({
        source: { type: 'code_owned' as const },
        state: 'available' as const,
        tool,
      })),
    ),
};

function createMockModelClient(model: MockLanguageModelV3): ModelClient {
  return {
    model: 'mock',
    provider: 'mock',
    contextWindowTokens: 128_000,
    streamText(input: ModelStreamInput) {
      return streamText({
        model,
        system: input.system,
        messages: input.messages,
        abortSignal: input.abortSignal,
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') input.onTextDelta?.(chunk.text);
          else if (chunk.type === 'reasoning-delta')
            input.onReasoningDelta?.(chunk.text, chunk.id);
        },
        onError: input.onError,
        onFinish: (event) =>
          input.onFinish?.({
            text: event.text,
            usage: event.usage,
            finishReason: event.finishReason,
          }),
      });
    },
  };
}

/** Records the model input of every attempt, so the request the run built is
 * assertable without touching the provider. */
function recordingClient(calls: Array<ModelStreamInput>): ModelClient {
  const delegate = createMockModelClient(
    new MockLanguageModelV3({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: 'resumed answer' },
              { type: 'text-end', id: 't' },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ] satisfies Array<LanguageModelV3StreamPart>,
          }),
        }),
    }),
  );
  return {
    ...delegate,
    streamText(input) {
      calls.push(input);
      return delegate.streamText(input);
    },
  };
}

function carriesProviderMetadata(
  part: unknown,
): part is { type: string; providerMetadata: unknown } {
  return isRecord(part) && part.providerMetadata !== undefined;
}

describeIfDb(
  'reasoning provider metadata across a worker restart (D15/D17)',
  () => {
    let sql: SqlClient;
    let tenantDb: TenantDbService;
    let service: RunExecutionService;
    let userId: string;

    beforeAll(async () => {
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sql = postgres(TEST_DB_URL!, { ssl, max: 5 });
      const db: Db = drizzle(sql, { schema });
      tenantDb = new TenantDbService(db);
      const noopCompaction: CompactionCapability = {
        maybeCompact: async () => {},
        // Never exercised here: every seeded context fits the mock model's
        // context window.
        compactForTransition: () => {
          throw new Error(
            'reasoning-metadata-replay compactForTransition is not exercised by this suite',
          );
        },
      };
      const noopTitles: TitleCapability = {
        maybeGenerateTitle: async () => {},
      };
      const instanceConfig: InstanceConfigReader = {
        config: BUILT_IN_DEFAULTS,
      };
      service = new RunExecutionService(
        tenantDb,
        noopCompaction,
        noopTitles,
        instanceConfig,
        new SearchIndexService(tenantDb),
        noopReindexDispatch(),
        knowledgeResolver,
        noopSkillCatalog(),
        noopEmbedDispatch(),
        noopQueryEmbedder(),
        compileTestPermissionPolicy(),
        models,
        new SystemPromptsService(),
        { resolvePromptUser: () => Promise.resolve(undefined) },
        knowledgeCandidates,
        { snapshotCandidates: () => [] },
        new MemoryService(tenantDb),
        new RecencyDigestService(tenantDb),
        undefined,
      );
      userId = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'R', ${`rm-${userId}@t.com`})`;
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM users WHERE id = ${userId}`;
        await sql.end();
      }
    });

    /**
     * A turn that died mid-flight: the model streamed reasoning (with the
     * adapter's opaque metadata) and called a tool, and the worker never
     * continued the turn. Settling the run from those durable events is the
     * restart idiom the retry-exhaustion/settlement suites use.
     */
    async function seedInterruptedTurn() {
      const chatId = crypto.randomUUID();
      const userMessage = await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
        });
        return new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'search, then answer' }],
        });
      });
      const interrupted = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).create({
          chatId,
          messageId: userMessage.id,
          userId,
          modelId: MODEL_ID,
        }),
      );
      await tenantDb.runAs(userId, async (tx) => {
        const events = new RunEventsRepository(tx);
        // Opaque metadata the adapter delivered for a reasoning item that never
        // produced a persisted part: private run state, never chat context. It
        // arrives with no reasoning part to bind to (the item carried no
        // displayable text), so nothing in the transcript may retain it.
        await events.append(interrupted.id, 'reasoning.delta', {
          partId: 'rs-orphan-1',
          providerMetadata: ORPHAN_PROVIDER_METADATA,
        });
        // The run records a reasoning part as two events in this order: its
        // text (no metadata — a text delta never carries any), then the
        // metadata the adapter attaches to the part's END, with no text.
        await events.append(interrupted.id, 'reasoning.delta', {
          text: REASONING_TEXT,
          partId: 'rs-resumed-1',
        });
        await events.append(interrupted.id, 'reasoning.delta', {
          partId: 'rs-resumed-1',
          providerMetadata: PROVIDER_METADATA,
        });
        await events.append(interrupted.id, 'tool.requested', {
          toolCallId: 'call-resumed-1',
          toolName: 'search_conversations',
          input: { query: 'budget' },
        });
        await events.append(interrupted.id, 'tool.completed', {
          toolCallId: 'call-resumed-1',
          output: { status: 'success', matches: [] },
        });
      });
      return { chatId, userMessage, interrupted };
    }

    it('a resumed Run replays the earlier reasoning part with its metadata on its first request', async () => {
      const { chatId, interrupted } = await seedInterruptedTurn();

      // The restarted worker settles the stranded run; the turn's parts become
      // the chat's stored history.
      const settlement = await service.settleTerminalRun({
        runId: interrupted.id,
        userId,
        status: 'expired',
        runPayload: { status: 'expired', message: 'worker restarted' },
        error: { message: 'worker restarted' },
      });
      expect(settlement.outcome).toBe('won');
      const persisted = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userId),
      );
      const persistedAssistant = persisted.find(
        (message) => message.role === 'assistant',
      );
      expect(persistedAssistant?.parts[0]).toEqual({
        type: 'reasoning',
        text: REASONING_TEXT,
        providerMetadata: PROVIDER_METADATA,
      });

      // The resumed Run: the next turn on the same chat, driven through the same
      // entry point a worker uses for a claimed queued run. All it inherits from
      // the dead worker is the durable state above.
      const nextUser = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'continue' }],
        }),
      );
      const resumed = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).create({
          chatId,
          messageId: nextUser.id,
          userId,
          modelId: MODEL_ID,
        }),
      );

      const calls: Array<ModelStreamInput> = [];
      const result = await service.executeRun({
        runId: resumed.id,
        chatId,
        userId,
        userMessage: {
          id: nextUser.id,
          seq: nextUser.seq,
          parts: nextUser.parts.filter(isTextPart),
        },
        client: recordingClient(calls),
      });
      await result.consumeStream?.();
      await vi.waitFor(async () => {
        const events = await tenantDb.runAs(userId, (tx) =>
          new RunEventsRepository(tx).listByRunId(resumed.id, userId),
        );
        expect(
          events.some((event) => event.eventType === 'run.completed'),
        ).toBe(true);
      });

      expect(calls).toHaveLength(1);
      const first = calls[0];
      // The rebuilt request's assistant turn carries the reasoning part with its
      // metadata (opaque, unreshaped) ahead of the tool call it preceded.
      expect(first.messages).toContainEqual({
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: REASONING_TEXT,
            providerOptions: PROVIDER_METADATA,
          },
          expect.objectContaining({
            type: 'tool-call',
            toolCallId: 'call-resumed-1',
          }),
        ],
      });
      const assistantParts: Array<unknown> = first.messages.flatMap(
        (message) =>
          message.role === 'assistant' && Array.isArray(message.content)
            ? message.content
            : [],
      );
      // Exactly one reasoning part, with its unmodified text and the metadata
      // the provider produced …
      expect(
        assistantParts.filter(
          (part) => isRecord(part) && part.type === 'reasoning',
        ),
      ).toEqual([
        {
          type: 'reasoning',
          text: REASONING_TEXT,
          providerOptions: PROVIDER_METADATA,
        },
      ]);
      // … and it is the only part that carries metadata at all. The tool result
      // stays a tool message: metadata reaches the provider on a reasoning part.
      expect(
        assistantParts.filter(
          (part) => isRecord(part) && part.providerOptions !== undefined,
        ),
      ).toHaveLength(1);
      expect(
        JSON.stringify(
          first.messages.filter((message) => message.role !== 'assistant'),
        ),
      ).not.toContain('ENCRYPTED_RESUMED');

      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    });

    it('retains only metadata bound to a persisted reasoning part once the run is terminal', async () => {
      const { chatId, interrupted } = await seedInterruptedTurn();
      await service.settleTerminalRun({
        runId: interrupted.id,
        userId,
        status: 'expired',
        runPayload: { status: 'expired', message: 'worker restarted' },
        error: { message: 'worker restarted' },
      });

      const messages = await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, userId),
      );
      // Exactly one persisted value carries opaque state, and it is the reasoning
      // part that state belongs to — the metadata bound to a part is durable with
      // it, and metadata with no part to be bound to (the orphan delivery above)
      // is gone once the run is terminal.
      const carrying = messages.flatMap((message) =>
        message.parts.filter(carriesProviderMetadata),
      );
      expect(carrying).toHaveLength(1);
      expect(carrying[0]).toEqual({
        type: 'reasoning',
        text: REASONING_TEXT,
        providerMetadata: PROVIDER_METADATA,
      });
      // Nothing else in the transcript — a non-reasoning part, usage, or
      // attachments — retains either delivery, and the unbound one is nowhere.
      const transcript = JSON.stringify(
        messages.map(({ parts, usage, attachments }) => ({
          parts,
          usage,
          attachments,
        })),
      );
      expect(transcript).not.toContain('ENCRYPTED_ORPHAN');
      expect(transcript).not.toContain('rs-orphan-1');
      const nonReasoningParts = JSON.stringify(
        messages.flatMap(({ parts }) =>
          parts.filter((part) => !isRecord(part) || part.type !== 'reasoning'),
        ),
      );
      expect(nonReasoningParts).not.toContain('ENCRYPTED_RESUMED');

      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    });
  },
);
