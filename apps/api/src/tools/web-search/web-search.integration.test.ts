import { Logger } from '@nestjs/common';
import { NoSuchToolError, stepCountIs, streamText } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';
import * as schema from '../../db/schema';
import type { RunEvent } from '../../db/schema';
import { TenantDbService, type Db } from '../../db/tenant-db.service';
import {
  ChatsRepository,
  MessagesRepository,
} from '../../chats/chats-repository';
import { isTextPart } from '../../chats/context-builder';
import type { CompactionCapability } from '../../compaction/compaction.service';
import {
  BUILT_IN_DEFAULTS,
  type WebSearchConfig,
} from '../../instance-config/llame-config';
import type { InstanceConfigReader } from '../../instance-config/instance-config.service';
import { MemoryService } from '../../memory/memory.service';
import type { ModelClient, ModelStreamInput } from '../../models/model-client';
import type { ModelSelectionValidator } from '../../models/models.service';
import type { SystemModelCatalogEntry } from '../../models/model-catalog';
import { noopEmbedDispatch } from '../../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../../search/chat-search-query-embedder.stub';
import { SearchIndexService } from '../../search/search-index.service';
import { noopReindexDispatch } from '../../search/search-reindex-dispatch.stub';
import { RecencyDigestService } from '../../chats/recency-digest.service';
import { RunExecutionService } from '../../runs/run-execution.service';
import {
  RunEventsRepository,
  RunsRepository,
} from '../../runs/runs-repository';
import { SystemPromptsService } from '../../system-prompts/system-prompts.service';
import { noopSkillCatalog } from '../../skills/skill-catalog.stub';
import { waitFor } from '../../testing/support';
import { compileToolPermissionMap } from '../permissions/compile-permissions';
import type { CompiledPolicy } from '../permissions/types';
import { TOOL_REGISTRY } from '../registry';
import type { KnowledgeToolResolver } from '../types';
import type { KnowledgeToolCandidateResolverPort } from '../../knowledge/knowledge-tool-candidate-resolver';
import { BRAVE_SEARCH_URL } from './brave';
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
const SENTINEL_KEY = 'brave-canary';
const BRAVE_ORIGIN = new URL(BRAVE_SEARCH_URL).origin;
const FIXTURE_QUERY = 'fixture query';
const FIXTURE_RESULT_URL = 'https://Example.test/results/page#fragment';
const FIXTURE_DESCRIPTION = `<b>${'x'.repeat(400)}</b>`;
const USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
} satisfies LanguageModelV3Usage;
const TOOL_FINISH = {
  unified: 'tool-calls',
  raw: undefined,
} satisfies LanguageModelV3FinishReason;
const STOP_FINISH = {
  unified: 'stop',
  raw: undefined,
} satisfies LanguageModelV3FinishReason;
type ToolInput = { query?: string; limit?: number; path?: string };
function textResponse(text: string): LanguageModelV3StreamResult {
  const chunks: Array<LanguageModelV3StreamPart> = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: text },
    { type: 'text-end', id: 'answer' },
    { type: 'finish', finishReason: STOP_FINISH, usage: USAGE },
  ];
  return { stream: simulateReadableStream({ chunks }) };
}
function toolResponse(
  id: string,
  name: string,
  input: ToolInput,
): LanguageModelV3StreamResult {
  const chunks: Array<LanguageModelV3StreamPart> = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: id,
      toolName: name,
      input: JSON.stringify(input),
    },
    { type: 'finish', finishReason: TOOL_FINISH, usage: USAGE },
  ];
  return { stream: simulateReadableStream({ chunks }) };
}
const toolInputSchema = z.object({
  query: z.string().optional(),
  limit: z.number().optional(),
  path: z.string().optional(),
});
type ParsedToolInput = z.infer<typeof toolInputSchema> | string;
function parseToolInput(value: string): ParsedToolInput {
  try {
    // SAFETY: JSON.parse is an input boundary; zod narrows the decoded value.
    const decoded: unknown = JSON.parse(value);
    const parsed = toolInputSchema.safeParse(decoded);
    return parsed.success ? parsed.data : value;
  } catch {
    return value;
  }
}
type StreamOptions = Parameters<typeof streamText>[0];
function createClient(
  model: MockLanguageModelV3,
  calls?: Array<ModelStreamInput>,
): ModelClient {
  return {
    model: 'mock',
    provider: 'mock',
    contextWindowTokens: 100_000,
    streamText(input) {
      calls?.push(input);
      const options: StreamOptions = {
        model,
        system: input.system,
        messages: input.messages,
        abortSignal: input.abortSignal,
        onChunk: ({ chunk }) =>
          chunk.type === 'text-delta'
            ? input.onTextDelta?.(chunk.text)
            : chunk.type === 'reasoning-delta'
              ? input.onReasoningDelta?.(chunk.text)
              : undefined,
        onError: input.onError,
        onFinish: (event) =>
          input.onFinish?.({
            text: event.text,
            usage: event.usage,
            finishReason: event.finishReason,
            stepCount: event.steps.length,
          }),
      };
      if (input.tools !== undefined) {
        const maxSteps = input.maxSteps ?? undefined;
        options.tools = input.tools;
        options.stopWhen =
          maxSteps === undefined ? () => false : stepCountIs(maxSteps + 1);
        options.prepareStep = async ({ steps, stepNumber, messages }) => {
          const override = await input.onStepStart?.({ messages, stepNumber });
          const capped =
            maxSteps !== undefined &&
            steps.filter((step) => step.toolCalls.length > 0).length >=
              maxSteps;
          if (capped) input.onCapReached?.();
          return capped
            ? override === undefined
              ? { activeTools: [] }
              : { messages: override, activeTools: [] }
            : override === undefined
              ? {}
              : { messages: override };
        };
        options.experimental_repairToolCall = ({ toolCall, error }) => {
          input.onUnavailableToolCall?.({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: parseToolInput(toolCall.input),
            reason: NoSuchToolError.isInstance(error)
              ? 'not_available'
              : 'invalid_input',
          });
          return Promise.resolve(null);
        };
      }
      return streamText(options);
    },
  };
}
function modelFor(
  script: (turn: number) => LanguageModelV3StreamResult,
): MockLanguageModelV3 {
  let turn = 0;
  return new MockLanguageModelV3({
    doStream: () => Promise.resolve(script(++turn)),
  });
}
type FixtureMode = 'success' | 'hold' | 'auth' | 'redirect';
type Deferred = { promise: Promise<void>; resolve: () => void };
type FixtureState = {
  mode: FixtureMode;
  target: string | undefined;
  requests: Array<string>;
  started: Deferred;
  aborted: Deferred;
};
type Fixture = {
  origin: string;
  requests: Array<string>;
  configure: (mode: FixtureMode, target?: string) => void;
  started: () => Promise<void>;
  aborted: () => Promise<void>;
  close: () => Promise<void>;
};
function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = () => done();
  });
  return { promise, resolve };
}
function resetFixture(
  state: FixtureState,
  mode: FixtureMode,
  target?: string,
): void {
  state.mode = mode;
  state.target = target;
  state.requests.length = 0;
  state.started = deferred();
  state.aborted = deferred();
}
function send(
  response: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, headers);
  response.end(body);
}
function handleFixture(
  state: FixtureState,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  state.requests.push(request.url ?? '');
  state.started.resolve();
  request.on('error', () => undefined);
  response.on('error', () => undefined);
  if (state.mode === 'hold') {
    request.on('aborted', state.aborted.resolve);
    response.on('close', () => {
      if (!response.writableEnded) state.aborted.resolve();
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    return;
  }
  if (state.mode === 'auth')
    send(
      response,
      401,
      JSON.stringify({ error: `invalid key ${SENTINEL_KEY}` }),
      { 'content-type': 'application/json' },
    );
  else if (state.mode === 'redirect')
    send(response, 302, 'redirect', { location: state.target ?? '/sink' });
  else
    send(
      response,
      200,
      JSON.stringify({
        web: {
          results: [
            {
              title: 'Fixture result',
              url: FIXTURE_RESULT_URL,
              description: FIXTURE_DESCRIPTION,
              page_age: '2026-10-08T00:00:00.000Z',
            },
          ],
        },
      }),
      { 'content-type': 'application/json' },
    );
}
function isAddressInfo(
  address: AddressInfo | string | null,
): address is AddressInfo {
  return address !== null && typeof address !== 'string';
}
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!isAddressInfo(address)) throw new Error('Fixture server did not start.');
  return address.port;
}
async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function startFixture(): Promise<Fixture> {
  const state: FixtureState = {
    mode: 'success',
    target: undefined,
    requests: [],
    started: deferred(),
    aborted: deferred(),
  };
  const server = createServer((request, response) =>
    handleFixture(state, request, response),
  );
  server.on('clientError', (_error, socket) => socket.destroy());
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    requests: state.requests,
    configure: (mode, target) => resetFixture(state, mode, target),
    started: () => state.started.promise,
    aborted: () => state.aborted.promise,
    close: () => closeServer(server),
  };
}
function stubFetch(fixture: Fixture): () => void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const requested = isString(input)
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);
    if (requested.origin !== BRAVE_ORIGIN)
      throw new Error(`Unexpected outbound URL: ${requested.href}`);
    return realFetch(
      new URL(`${requested.pathname}${requested.search}`, fixture.origin),
      init,
    );
  });
  return () => vi.unstubAllGlobals();
}
const SEARCH_CONFIG: WebSearchConfig = {
  engines: [
    { id: 'brave', type: 'brave', key: SENTINEL_KEY, timeoutSeconds: 60 },
  ],
  chain: ['brave'],
};
const knowledgeResolver: KnowledgeToolResolver = {
  listForOwnerPage: () => Promise.resolve({ spaces: [] }),
  resolveBindingForOwnerById: () => Promise.resolve(undefined),
  createAdapter: () => ({
    search: () => Promise.resolve([]),
    resolveHostPath: () => Promise.reject(new Error('not exercised')),
    isInsideSpace: () => Promise.resolve(true),
  }),
};
const testModelEntry: SystemModelCatalogEntry = {
  id: 'mock',
  source: 'system',
  contextWindowTokens: 100_000,
  provider: 'mock',
  providerModelId: 'mock',
  systemPromptTemplate: 'Test prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
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
const ALLOW_SEARCH = compileToolPermissionMap(
  { web_search: { allow: true } },
  'web-search-test-policy',
);
const REJECT_QUERY = compileToolPermissionMap(
  {
    web_search: {
      allow: true,
      reject: [{ field: 'query', literal: 'blocked query' }],
    },
  },
  'web-search-test-policy',
);
const ALLOW_SEARCH_AND_READ = compileToolPermissionMap(
  {
    web_search: { allow: true },
    read: { allow: [{ field: 'path', regex: '^/' }] },
  },
  'web-search-test-policy',
);
type ServiceOptions = {
  allowed: ReadonlyArray<string>;
  permissionPolicy: CompiledPolicy;
  timeout?: number;
};
function service(options: ServiceOptions): RunExecutionService {
  const config: InstanceConfigReader = {
    config: {
      ...BUILT_IN_DEFAULTS,
      webSearch: SEARCH_CONFIG,
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        allowed: options.allowed,
        permissions: {},
        permissionModes: ['default'],
        callTimeoutSeconds: options.timeout ?? 120,
        webAdapters: [],
      },
    },
  };
  const models: ModelSelectionValidator = {
    validateModelSelection: () => testModelEntry,
    resolveEffortSelection: () => undefined,
  };
  const compaction: CompactionCapability = {
    summarizeCheckpoint: () => Promise.resolve(null),
  };
  return new RunExecutionService(
    tenantDb,
    compaction,
    { maybeGenerateTitle: async () => {} },
    config,
    new SearchIndexService(tenantDb),
    noopReindexDispatch(),
    knowledgeResolver,
    noopSkillCatalog(),
    noopEmbedDispatch(),
    noopQueryEmbedder(),
    options.permissionPolicy,
    models,
    new SystemPromptsService(),
    { resolvePromptUser: () => Promise.resolve(undefined) },
    knowledgeCandidates,
    { snapshotCandidates: () => [] },
    new MemoryService(tenantDb),
    new RecencyDigestService(tenantDb),
    undefined,
    undefined,
    undefined,
  );
}
let sql!: Sql;
let tenantDb!: TenantDbService;
let userId!: string;
let fixture!: Fixture;
let restoreFetch!: () => void;
const activeChats = new Set<string>();
async function seedRun(label: string) {
  const chatId = crypto.randomUUID();
  const seeded = await tenantDb.runAs(userId, async (tx) => {
    await new ChatsRepository(tx).createIfAbsent({
      id: chatId,
      ownerUserId: userId,
      title: `Web search ${label}`,
    });
    const userMessage = await new MessagesRepository(tx).create({
      chatId,
      role: 'user',
      senderUserId: userId,
      parts: [{ type: 'text', text: 'search the fixture' }],
    });
    const run = await new RunsRepository(tx).create({
      chatId,
      messageId: userMessage.id,
      userId,
      modelId: `test:web-search-${label}-${crypto.randomUUID()}`,
    });
    return { userMessage, run };
  });
  activeChats.add(chatId);
  return { chatId, ...seeded };
}
type Seeded = {
  chatId: string;
  userMessage: { id: string; seq: number; parts: Array<unknown> };
  run: { id: string };
};
type ExecuteOptions = { signal?: AbortSignal; calls?: Array<ModelStreamInput> };
async function execute(
  seeded: Seeded,
  runner: RunExecutionService,
  model: MockLanguageModelV3,
  options?: ExecuteOptions,
): Promise<void> {
  const request: Parameters<RunExecutionService['executeRun']>[0] = {
    runId: seeded.run.id,
    chatId: seeded.chatId,
    userId,
    userMessage: {
      id: seeded.userMessage.id,
      seq: seeded.userMessage.seq,
      parts: seeded.userMessage.parts.filter(isTextPart),
    },
    client: createClient(model, options?.calls),
  };
  if (options?.signal !== undefined) request.abortSignal = options.signal;
  const result = await runner.executeRun(request);
  await result.consumeStream?.();
}
async function waitStatus(
  runId: string,
  status: 'completed' | 'cancelled' | 'expired' | 'failed',
): Promise<void> {
  await waitFor(
    async () => {
      const run = await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(runId, userId),
      );
      return run?.status === status ? true : undefined;
    },
    5000,
    `${status} run`,
  );
}
async function eventsFor(runId: string): Promise<Array<RunEvent>> {
  return tenantDb.runAs(userId, (tx) =>
    new RunEventsRepository(tx).listByRunId(runId, userId),
  );
}
const partSchema = z.record(z.string(), z.unknown());
type Part = UnknownRecord;
const partsSchema = z.array(partSchema);
async function assistantParts(chatId: string): Promise<Array<Part>> {
  const messages = await tenantDb.runAs(userId, (tx) =>
    new MessagesRepository(tx).findByChatId(chatId, userId),
  );
  const assistant = messages.find((message) => message.role === 'assistant');
  if (assistant === undefined)
    throw new Error('Assistant message was not persisted.');
  return partsSchema.parse(assistant.parts);
}
function partOf(parts: ReadonlyArray<Part>, type: string): Part | undefined {
  return parts.find((part) => part['type'] === type);
}
const eventPayloadSchema = z.record(z.string(), z.unknown());
function callEvents(
  events: ReadonlyArray<RunEvent>,
  id: string,
): Array<RunEvent> {
  return events.filter(
    (event) =>
      eventPayloadSchema.safeParse(event.payload).success &&
      eventPayloadSchema.parse(event.payload)['toolCallId'] === id,
  );
}
function lastEvent(events: ReadonlyArray<RunEvent>): RunEvent {
  const event = events.at(-1);
  if (event === undefined) throw new Error('Expected a tool event.');
  return event;
}
function payload(event: RunEvent): UnknownRecord {
  return eventPayloadSchema.parse(event.payload);
}
const errorSchema = z.object({
  status: z.literal('error'),
  type: z.string(),
  message: z.string().optional(),
});
const resultSchema = z.object({
  kind: z.literal('results'),
  engine: z.string(),
  query: z.string(),
  results: z.array(z.object({ url: z.string(), snippet: z.string() })),
});
type LogCapture = { text: () => string; restore: () => void };
function captureLogs(): LogCapture {
  const spies = [
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
  ];
  return {
    text: () => JSON.stringify(spies.map((spy) => spy.mock.calls)),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}
const ALLOW_READ = compileToolPermissionMap(
  { read: { allow: true } },
  'web-search-test-policy',
);
const FAILURE_CASES: ReadonlyArray<{
  label: string;
  mode: Exclude<FixtureMode, 'success' | 'hold'>;
  expected: string;
  secret: boolean;
}> = [
  { label: 'auth', mode: 'auth', expected: 'auth', secret: true },
  {
    label: 'redirect',
    mode: 'redirect',
    expected: 'upstream_error',
    secret: false,
  },
];
describeIfDb('web search through the real tool loop', () => {
  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = postgres(TEST_DB_URL!, { ssl, max: 3 });
    const db: Db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Web Search', ${`web-search-${userId}@test.com`})`;
    fixture = await startFixture();
    restoreFetch = stubFetch(fixture);
  });
  afterEach(async () => {
    for (const chatId of activeChats)
      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    activeChats.clear();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    restoreFetch?.();
    await fixture?.close();
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });
  it('allowlisted search returns normalized results and persists the bounded part', async () => {
    fixture.configure('success');
    const seeded = await seedRun('success');
    const model = modelFor((turn) =>
      turn === 1
        ? toolResponse('search-call', 'web_search', {
            query: FIXTURE_QUERY,
            limit: 10,
          })
        : textResponse('Search completed.'),
    );
    await execute(
      seeded,
      service({ allowed: ['web_search'], permissionPolicy: ALLOW_SEARCH }),
      model,
    );
    await waitStatus(seeded.run.id, 'completed');
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests.at(0)).toContain('q=fixture+query');
    const part = partOf(await assistantParts(seeded.chatId), 'tool-web_search');
    expect(part).toMatchObject({
      toolCallId: 'search-call',
      state: 'output-available',
      input: { query: FIXTURE_QUERY, limit: 10 },
      outcome: 'success',
    });
    const output = resultSchema.parse(part?.['output']);
    expect(output).toMatchObject({
      kind: 'results',
      engine: 'brave',
      query: FIXTURE_QUERY,
    });
    expect(output.results.at(0)?.url).toBe('https://example.test/results/page');
    expect(output.results.at(0)?.snippet.length).toBeLessThanOrEqual(300);
    expect(output.results.at(0)?.snippet).not.toContain('<b>');
  });
  it('rejects a query permission before the Brave fixture receives a request', async () => {
    fixture.configure('success');
    const seeded = await seedRun('permission-rejected');
    const model = modelFor((turn) =>
      turn === 1
        ? toolResponse('rejected-call', 'web_search', {
            query: 'blocked query',
          })
        : textResponse('Permission rejection was non-fatal.'),
    );
    await execute(
      seeded,
      service({ allowed: ['web_search'], permissionPolicy: REJECT_QUERY }),
      model,
    );
    await waitStatus(seeded.run.id, 'completed');
    expect(fixture.requests).toHaveLength(0);
    const calls = callEvents(await eventsFor(seeded.run.id), 'rejected-call');
    expect(calls.map((event) => event.eventType)).toEqual([
      'tool.requested',
      'tool.completed',
    ]);
    expect(errorSchema.parse(payload(lastEvent(calls)).output)).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
  });
  it('cancels an in-flight Brave request and settles the tool as cancelled', async () => {
    fixture.configure('hold');
    const seeded = await seedRun('cancelled');
    const controller = new AbortController();
    const running = execute(
      seeded,
      service({ allowed: ['web_search'], permissionPolicy: ALLOW_SEARCH }),
      modelFor(() =>
        toolResponse('cancelled-call', 'web_search', { query: FIXTURE_QUERY }),
      ),
      { signal: controller.signal },
    );
    await fixture.started();
    await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).requestCancel(seeded.run.id, userId),
    );
    controller.abort();
    await running;
    await waitStatus(seeded.run.id, 'cancelled');
    await fixture.aborted();
    const calls = callEvents(await eventsFor(seeded.run.id), 'cancelled-call');
    expect(errorSchema.parse(payload(lastEvent(calls)).output)).toMatchObject({
      status: 'error',
      type: 'cancelled',
    });
    expect(
      partOf(await assistantParts(seeded.chatId), 'tool-web_search'),
    ).toMatchObject({
      state: 'output-error',
      outcome: 'cancelled',
      resultProviderMetadata: { llame: { cancelled: true } },
    });
  });
  it('aborts an in-flight request at the call deadline and records timeout', async () => {
    fixture.configure('hold');
    const seeded = await seedRun('deadline');
    const model = modelFor((turn) =>
      turn === 1
        ? toolResponse('deadline-call', 'web_search', { query: FIXTURE_QUERY })
        : textResponse('The deadline was recorded.'),
    );
    await execute(
      seeded,
      service({
        allowed: ['web_search'],
        permissionPolicy: ALLOW_SEARCH,
        timeout: 0.1,
      }),
      model,
    );
    await waitStatus(seeded.run.id, 'completed');
    await fixture.aborted();
    expect(
      errorSchema.parse(
        payload(
          lastEvent(
            callEvents(await eventsFor(seeded.run.id), 'deadline-call'),
          ),
        ).output,
      ),
    ).toMatchObject({ status: 'error', type: 'timeout' });
  });
  it.each(FAILURE_CASES)(
    '$label failure is mapped without following redirects',
    async ({ label, mode, expected, secret }) => {
      fixture.configure(
        mode,
        mode === 'redirect' ? `${fixture.origin}/sink` : undefined,
      );
      const logs = secret ? captureLogs() : undefined;
      try {
        const seeded = await seedRun(label);
        const model = modelFor((turn) =>
          turn === 1
            ? toolResponse(`${label}-call`, 'web_search', {
                query: FIXTURE_QUERY,
              })
            : textResponse('The failure was handled.'),
        );
        await execute(
          seeded,
          service({ allowed: ['web_search'], permissionPolicy: ALLOW_SEARCH }),
          model,
        );
        await waitStatus(seeded.run.id, 'completed');
        expect(fixture.requests).toHaveLength(1);
        const events = await eventsFor(seeded.run.id);
        const error = errorSchema.parse(
          payload(lastEvent(callEvents(events, `${label}-call`))).output,
        );
        expect(error).toMatchObject({
          status: 'error',
          type: 'web_search_failed',
        });
        expect(error.message).toContain(expected);
        if (secret) {
          expect(
            JSON.stringify(await assistantParts(seeded.chatId)),
          ).not.toContain(SENTINEL_KEY);
          expect(JSON.stringify(events)).not.toContain(SENTINEL_KEY);
          expect(logs?.text()).not.toContain(SENTINEL_KEY);
        }
      } finally {
        logs?.restore();
      }
    },
  );
  it('records an unavailable web_search call as a non-fatal error and continues', async () => {
    fixture.configure('success');
    const seeded = await seedRun('unlisted');
    const calls: Array<ModelStreamInput> = [];
    const model = modelFor((turn) =>
      turn === 1
        ? toolResponse('unlisted-web-search', 'web_search', {
            query: 'hallucinated query',
          })
        : textResponse('I continued.'),
    );
    await execute(
      seeded,
      service({ allowed: ['read'], permissionPolicy: ALLOW_READ }),
      model,
      { calls },
    );
    await waitStatus(seeded.run.id, 'completed');
    expect(Object.keys(calls.at(0)?.tools ?? {})).not.toContain('web_search');
    const events = await eventsFor(seeded.run.id);
    const toolEvents = callEvents(events, 'unlisted-web-search');
    expect(toolEvents.map((event) => event.eventType)).toEqual([
      'tool.requested',
      'tool.completed',
    ]);
    expect(
      errorSchema.parse(payload(lastEvent(toolEvents)).output),
    ).toMatchObject({ status: 'error', type: 'not_available' });
    expect(events.map((event) => event.eventType)).toContain('run.completed');
  });
  it('allows web_search independently while read rejects the returned URL before any request', async () => {
    fixture.configure('success');
    const seeded = await seedRun('read-policy');
    const model = modelFor((turn) => {
      if (turn === 1)
        return toolResponse('search-for-read-policy', 'web_search', {
          query: FIXTURE_QUERY,
        });
      if (turn === 2)
        return toolResponse('read-returned-url', 'read', {
          path: 'https://example.test/results/page',
        });
      return textResponse('The read was blocked.');
    });
    await execute(
      seeded,
      service({
        allowed: ['web_search', 'read'],
        permissionPolicy: ALLOW_SEARCH_AND_READ,
      }),
      model,
    );
    await waitStatus(seeded.run.id, 'completed');
    expect(fixture.requests).toHaveLength(1);
    const readEvents = callEvents(
      await eventsFor(seeded.run.id),
      'read-returned-url',
    );
    expect(readEvents.map((event) => event.eventType)).toEqual([
      'tool.requested',
      'tool.completed',
    ]);
    expect(payload(readEvents.at(0)!).permission).toMatchObject({
      decision: 'reject',
      reason: 'no_allow',
    });
    expect(
      errorSchema.parse(payload(lastEvent(readEvents)).output),
    ).toMatchObject({ status: 'error', type: 'permission_denied' });
    expect(
      partOf(await assistantParts(seeded.chatId), 'tool-read'),
    ).toMatchObject({ state: 'output-error', outcome: 'permission_denied' });
  });
});
