import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type LanguageModelV3StreamPart } from '@ai-sdk/provider';
import {
  NoSuchToolError,
  stepCountIs,
  streamText,
  type StepResult,
  type ToolSet,
} from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { SearchIndexService } from '../search/search-index.service';
import {
  canonicalJson,
  resolveEffectiveContext,
} from '../runs/effective-context-resolver';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { resolveBoundExecutableTools } from '../runs/snapshot-tool-execution';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { RunExecutionService } from '../runs/run-execution.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { type MessagePart } from '../chats/context-builder';
import {
  createToolAvailabilityPart,
  renderToolAvailabilityReminder,
} from '../chats/tool-availability-part';
import {
  composeTurnToolCatalog,
  type TurnToolCatalog,
} from '../tools/turn-tool-catalog';
import {
  MCP_RUNTIME_SERVER_DEFINITIONS,
  McpRuntimeModule,
} from './mcp-runtime.module';
import { McpRuntimeService } from './mcp-runtime.service';
import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
  type McpFixtureResponse,
} from './mcp-test-fixture';

const TOOL_ID = 'mcp__web__search';
const HEADER_SENTINEL = 'AUTH-HEADER-SENTINEL';
const API_SESSION_SENTINEL = 'api-session-sentinel';
const WORKER_SESSION_SENTINEL = 'worker-session-sentinel';
const RECONNECTED_SESSION_SENTINEL = 'api-reconnected-session-sentinel';

type SqlClient = ReturnType<typeof postgres>;

const rpcResult = (id: number, result: unknown): McpFixtureResponse => ({
  kind: 'json',
  body: { jsonrpc: '2.0', id, result },
});

const searchDeclaration = {
  name: 'search',
  description: 'Search current fixture evidence.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', minLength: 1 } },
    required: ['query'],
    additionalProperties: false,
  },
};

const discoveredSearch = (): McpFixtureResponse =>
  rpcResult(1, { tools: [searchDeclaration] });

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('timed out waiting for MCP fixture state');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function startRuntimeGraph(
  config: InstanceConfigService['config'],
): Promise<{
  readonly moduleRef: TestingModule;
  readonly runtime: McpRuntimeService;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [McpRuntimeModule],
  })
    .overrideProvider(InstanceConfigService)
    .useValue({ config })
    .compile();
  await moduleRef.init();
  return { moduleRef, runtime: moduleRef.get(McpRuntimeService) };
}

async function turnCatalog(
  runtime: McpRuntimeService,
): Promise<TurnToolCatalog> {
  const allowedToolRules = ['mcp__web__*'];
  return composeTurnToolCatalog({
    allowedToolRules,
    callTimeoutSeconds: BUILT_IN_DEFAULTS.tools.callTimeoutSeconds,
    candidates: runtime.snapshotCandidates(),
  });
}

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
}

function toolCallResponse(): {
  stream: ReadableStream<LanguageModelV3StreamPart>;
} {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'fixture-call',
      toolName: TOOL_ID,
      input: JSON.stringify({ query: 'release evidence' }),
    },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
      usage: usage(),
    },
  ];
  return {
    stream: simulateReadableStream({ chunks }),
  };
}

function textResponse(text: string): {
  stream: ReadableStream<LanguageModelV3StreamPart>;
} {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: text },
    { type: 'text-end', id: 'answer' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: usage(),
    },
  ];
  return {
    stream: simulateReadableStream({ chunks }),
  };
}

function createMockModelClient(model: MockLanguageModelV3): ModelClient {
  return {
    model: 'fixture-model',
    provider: 'fixture-provider',
    contextWindowTokens: 100_000,
    streamText(input: ModelStreamInput) {
      return streamText({
        model,
        system: input.system,
        messages: input.messages,
        abortSignal: input.abortSignal,
        ...(input.tools
          ? {
              tools: input.tools,
              stopWhen: stepCountIs((input.maxSteps ?? 8) + 1),
              prepareStep: ({ steps }: { steps: StepResult<ToolSet>[] }) => {
                const used = steps.filter(
                  (step) => step.toolCalls.length > 0,
                ).length;
                if (used >= (input.maxSteps ?? 8)) {
                  input.onCapReached?.();
                  return { activeTools: [] };
                }
                return {};
              },
              experimental_repairToolCall: ({ toolCall, error }) => {
                let parsedInput: unknown;
                try {
                  parsedInput = JSON.parse(toolCall.input) as unknown;
                } catch {
                  parsedInput = toolCall.input;
                }
                input.onUnavailableToolCall?.({
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: parsedInput,
                  reason: NoSuchToolError.isInstance(error)
                    ? 'not_available'
                    : 'invalid_input',
                });
                return Promise.resolve(null);
              },
            }
          : {}),
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') input.onTextDelta?.(chunk.text);
          if (chunk.type === 'reasoning-delta') {
            input.onReasoningDelta?.(chunk.text);
          }
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

function executionService(
  tenantDb: TenantDbService,
  runtime: McpRuntimeService,
): RunExecutionService {
  return new RunExecutionService(
    tenantDb,
    { maybeCompact: () => Promise.resolve() } as never,
    { maybeGenerateTitle: () => Promise.resolve() } as never,
    {
      config: {
        ...BUILT_IN_DEFAULTS,
        tools: {
          ...BUILT_IN_DEFAULTS.tools,
          allowed: ['mcp__web__*'],
        },
      },
    },
    new SearchIndexService(tenantDb),
    noopReindexDispatch(),
    runtime,
  );
}

describe('operator-configured MCP production acceptance', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let userId: string;

  beforeAll(async () => {
    const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
    if (!testDatabaseUrl) {
      throw new Error(
        'Integration global setup did not provide TEST_DATABASE_URL.',
      );
    }
    const ssl = /sslmode=require/.test(testDatabaseUrl) ? 'require' : false;
    sql = postgres(testDatabaseUrl, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'MCP Operator Acceptance', ${`mcp-operator-${userId}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  it('starts reachable servers independently and keeps turn snapshots network-free while one sibling is offline', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [mcpStreamableHttpInitialize()],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [discoveredSearch()],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    const random = vi.spyOn(Math, 'random').mockReturnValue(1);
    let moduleRef: TestingModule | undefined;

    try {
      const config = {
        ...BUILT_IN_DEFAULTS,
        mcpServers: {
          web: { type: 'streamable-http', url: fixture.url },
          offline: {
            type: 'streamable-http',
            url: 'http://127.0.0.1:1/mcp',
          },
        },
      } as const;
      const graph = await startRuntimeGraph(config);
      moduleRef = graph.moduleRef;

      expect(graph.runtime.snapshotCandidates()).toEqual([]);
      await waitFor(
        () => graph.runtime.resolveDynamicTool(TOOL_ID).state === 'available',
      );

      const requestsBeforeTurns = fixture.requestSummaries();
      for (let index = 0; index < 20; index += 1) {
        expect(graph.runtime.snapshotCandidates()).toEqual([
          expect.objectContaining({ state: 'available' }),
        ]);
      }
      expect(fixture.requestSummaries()).toEqual(requestsBeforeTurns);
    } finally {
      await moduleRef?.close();
      random.mockRestore();
      await fixture.close();
    }
  });

  it('binds independent API/worker state, persists a redacted result, replays it, and emits disconnect/reconnect deltas', async () => {
    const fixture = await createMcpTestFixture({
      $get: [
        { kind: 'raw', status: 405, body: '' },
        { kind: 'raw', status: 405, body: '' },
        { kind: 'raw', status: 405, body: '' },
        { kind: 'raw', status: 405, body: '' },
      ],
      initialize: [
        mcpStreamableHttpInitialize({ sessionId: API_SESSION_SENTINEL }),
        { kind: 'raw', status: 503, body: 'unavailable' },
        mcpStreamableHttpInitialize({ sessionId: WORKER_SESSION_SENTINEL }),
        mcpStreamableHttpInitialize({
          sessionId: RECONNECTED_SESSION_SENTINEL,
        }),
      ],
      'notifications/initialized': [
        { kind: 'raw', status: 204, body: '' },
        { kind: 'raw', status: 204, body: '' },
        { kind: 'raw', status: 204, body: '' },
      ],
      'tools/list': [
        discoveredSearch(),
        discoveredSearch(),
        discoveredSearch(),
      ],
      'tools/call': [
        rpcResult(2, {
          content: [
            {
              type: 'text',
              text: `fixture evidence ${HEADER_SENTINEL} ${WORKER_SESSION_SENTINEL}`,
            },
          ],
          structuredContent: {
            evidence: 'fixture evidence',
            echoedCredential: HEADER_SENTINEL,
            echoedSession: WORKER_SESSION_SENTINEL,
          },
        }),
        { kind: 'disconnect' },
      ],
      $delete: [
        { kind: 'raw', status: 204, body: '' },
        { kind: 'raw', status: 204, body: '' },
        { kind: 'raw', status: 204, body: '' },
      ],
    });
    const random = vi.spyOn(Math, 'random').mockReturnValue(1);
    const logSpies = [
      vi.spyOn(Logger.prototype, 'log'),
      vi.spyOn(Logger.prototype, 'warn'),
      vi.spyOn(Logger.prototype, 'error'),
      vi.spyOn(Logger.prototype, 'debug'),
    ];
    let apiModule: TestingModule | undefined;
    let workerModule: TestingModule | undefined;
    let chatId: string | undefined;

    try {
      const config = {
        ...BUILT_IN_DEFAULTS,
        mcpServers: {
          web: {
            type: 'streamable-http',
            url: fixture.url,
            headers: { authorization: HEADER_SENTINEL },
          },
        },
      } as const;
      const api = await startRuntimeGraph(config);
      apiModule = api.moduleRef;
      await waitFor(
        () => api.runtime.resolveDynamicTool(TOOL_ID).state === 'available',
      );
      const apiCatalog = await turnCatalog(api.runtime);
      expect(
        apiCatalog.admitted.map(({ declaration }) => declaration.id),
      ).toEqual([TOOL_ID]);
      expect(
        canonicalJson({
          manifest: apiCatalog.manifest,
          declarations: apiCatalog.admitted.map(
            ({ declaration }) => declaration,
          ),
        }),
      ).not.toContain('mcp__web__*');

      const worker = await startRuntimeGraph(config);
      workerModule = worker.moduleRef;
      await waitFor(() =>
        worker.runtime
          .snapshotCandidates()
          .some(
            (candidate) =>
              candidate.state === 'unavailable' &&
              candidate.reason === 'source_disconnected',
          ),
      );

      const diverged = await resolveBoundExecutableTools(
        apiCatalog.admitted.map(({ declaration }) => declaration),
        new Map(),
        worker.runtime,
      );
      expect(
        diverged[0]?.executor.execute(
          {
            userId,
            chatId: crypto.randomUUID(),
            tenantDb,
            toolCallId: 'diverged-call',
          },
          { query: 'must fail closed' },
        ),
      ).toMatchObject({ status: 'error', type: 'not_available' });

      await waitFor(
        () => worker.runtime.resolveDynamicTool(TOOL_ID).state === 'available',
        3000,
      );

      const model: SystemModelCatalogEntry = {
        id: 'test:mcp-operator',
        source: 'system',
        contextWindowTokens: 100_000,
        provider: 'fixture',
        providerModelId: 'fixture',
        systemPromptTemplate: 'Use the configured fixture search tool.',
        systemPromptSource: 'project_default',
      };
      const context = await resolveEffectiveContext({
        model,
        systemPrompt: model.systemPromptTemplate,
        allowedToolRules: ['mcp__web__*'],
        callTimeoutSeconds: BUILT_IN_DEFAULTS.tools.callTimeoutSeconds,
        candidates: [],
        dynamicCandidates: api.runtime.snapshotCandidates(),
      });
      expect(context.toolDeclarations.map(({ id }) => id)).toEqual([TOOL_ID]);
      expect(canonicalJson(context)).not.toContain('mcp__web__*');
      chatId = crypto.randomUUID();
      const seeded = await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId!,
          ownerUserId: userId,
          title: 'MCP operator acceptance',
        });
        const userMessage = await new MessagesRepository(tx).create({
          chatId: chatId!,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'Find the fixture evidence.' }],
        });
        const snapshot = await new ModelContextSnapshotsRepository(
          tx,
        ).createOrReuse(userId, context);
        const run = await new RunsRepository(tx).create({
          chatId: chatId!,
          messageId: userMessage.id,
          userId,
          modelId: model.id,
          modelContextSnapshotId: snapshot.id,
        });
        return { run, snapshot, userMessage };
      });

      const providerInputs: unknown[] = [];
      let step = 0;
      const firstModel = new MockLanguageModelV3({
        doStream: (input) => {
          providerInputs.push(input);
          step += 1;
          return Promise.resolve(
            step === 1
              ? toolCallResponse()
              : textResponse('The fixture evidence was found.'),
          );
        },
      });
      const service = executionService(tenantDb, worker.runtime);
      const result = await service.executeRun({
        runId: seeded.run.id,
        chatId,
        userId,
        userMessage: {
          id: seeded.userMessage.id,
          seq: seeded.userMessage.seq,
          parts: seeded.userMessage.parts as MessagePart[],
        },
        client: createMockModelClient(firstModel),
      });
      await result.consumeStream?.();

      const later = await tenantDb.runAs(userId, async (tx) => {
        const userMessage = await new MessagesRepository(tx).create({
          chatId: chatId!,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'Replay that evidence.' }],
        });
        const run = await new RunsRepository(tx).create({
          chatId: chatId!,
          messageId: userMessage.id,
          userId,
          modelId: model.id,
          modelContextSnapshotId: seeded.snapshot.id,
        });
        return { run, userMessage };
      });
      const replayProviderInputs: unknown[] = [];
      const replayModel = new MockLanguageModelV3({
        doStream: (input) => {
          replayProviderInputs.push(input);
          return Promise.resolve(textResponse('Replayed.'));
        },
      });
      const replayResult = await service.executeRun({
        runId: later.run.id,
        chatId,
        userId,
        userMessage: {
          id: later.userMessage.id,
          seq: later.userMessage.seq,
          parts: later.userMessage.parts as MessagePart[],
        },
        client: createMockModelClient(replayModel),
      });
      await replayResult.consumeStream?.();

      const [events, messages, receipt] = await tenantDb.runAs(
        userId,
        async (tx) => [
          await new RunEventsRepository(tx).listByRunId(seeded.run.id, userId),
          await new MessagesRepository(tx).findByChatId(chatId!, userId),
          await new ModelContextSnapshotsRepository(tx).findByOwnedRun(
            seeded.run.id,
            userId,
          ),
        ],
      );
      expect(
        events.find(({ eventType }) => eventType === 'tool.completed')?.payload,
      ).toMatchObject({
        output: {
          status: 'success',
          output: {
            structuredContent: {
              evidence: 'fixture evidence',
              echoedCredential: '[REDACTED]',
              echoedSession: '[REDACTED]',
            },
          },
        },
      });
      expect(canonicalJson(receipt)).not.toContain('mcp__web__*');
      expect(canonicalJson(providerInputs)).not.toContain('mcp__web__*');
      expect(canonicalJson(replayProviderInputs)).toContain('[REDACTED]');

      const durableAndModelSurfaces = canonicalJson({
        events,
        messages,
        receipt,
        providerInputs,
        replayProviderInputs,
        logs: logSpies.flatMap((spy) => spy.mock.calls),
      });
      for (const sentinel of [
        HEADER_SENTINEL,
        API_SESSION_SENTINEL,
        WORKER_SESSION_SENTINEL,
        RECONNECTED_SESSION_SENTINEL,
      ]) {
        expect(durableAndModelSurfaces).not.toContain(sentinel);
      }
      expect(
        fixture.receivedHeaderMatching(
          ({ rpcMethod }) => rpcMethod === 'tools/call',
          'authorization',
          HEADER_SENTINEL,
        ),
      ).toBe(true);

      const beforeDisconnect = await turnCatalog(api.runtime);
      const apiBound = await resolveBoundExecutableTools(
        beforeDisconnect.admitted.map(({ declaration }) => declaration),
        new Map(),
        api.runtime,
      );
      const apiExecutor = apiBound[0];
      if (apiExecutor === undefined) {
        throw new Error('API runtime did not bind the fixture executor.');
      }
      const disconnectResult = await apiExecutor.executor.execute(
        {
          userId,
          chatId,
          tenantDb,
          toolCallId: 'disconnect-call',
        },
        { query: 'disconnect now' },
      );
      expect(disconnectResult).toMatchObject({ status: 'error' });

      const disconnected = await turnCatalog(api.runtime);
      const unavailablePart = createToolAvailabilityPart({
        runId: crypto.randomUUID(),
        previous: beforeDisconnect.manifest,
        current: disconnected.manifest,
      });
      expect(
        unavailablePart && renderToolAvailabilityReminder(unavailablePart),
      ).toContain('Became unavailable:');

      try {
        await waitFor(
          () => api.runtime.resolveDynamicTool(TOOL_ID).state === 'available',
          3000,
        );
      } catch (error) {
        throw new Error(
          `API reconnect failed after requests ${canonicalJson(fixture.requestSummaries())}`,
          { cause: error },
        );
      }
      const reconnected = await turnCatalog(api.runtime);
      const availablePart = createToolAvailabilityPart({
        runId: crypto.randomUUID(),
        previous: disconnected.manifest,
        current: reconnected.manifest,
      });
      expect(
        availablePart && renderToolAvailabilityReminder(availablePart),
      ).toContain('Now available:');

      const definitions = api.moduleRef.get<
        Readonly<Record<string, Record<string, unknown>>>
      >(MCP_RUNTIME_SERVER_DEFINITIONS);
      expect(definitions['web']).toEqual({
        url: fixture.url,
        headers: { authorization: HEADER_SENTINEL },
      });
      expect(definitions['web']).not.toHaveProperty('type');
    } finally {
      if (chatId !== undefined) {
        await sql`DELETE FROM chats WHERE id = ${chatId}`;
      }
      await workerModule?.close();
      await apiModule?.close();
      for (const spy of logSpies) spy.mockRestore();
      random.mockRestore();
      await fixture.close();
    }
  });
});
