/**
 * Deterministic OpenAI-compatible mock for the browser e2e harness (#80/#49).
 *
 * The Playwright-launched api points OPENAI_BASE_URL here (#88), so chat-flow
 * browser tests exercise the real loop end-to-end with zero provider spend and
 * a fully deterministic answer. Speaks the /chat/completions streaming SSE
 * protocol — the endpoint the api's model client targets, and the one every
 * OpenAI-compatible provider implements.
 *
 * Behavior: answers with a fixed token sequence. A prompt containing "SLOW"
 * drips tokens over ~4s so tests can reload the page mid-answer (the resume
 * proof); anything else streams immediately. A prompt mentioning "search"
 * (and no prior tool result) instead emits an OpenAI-compatible
 * `search_conversations` tool_call — the real api-side loop
 * (openspec/changes/tool-calling-loop) executes it against a real DB-backed
 * search and re-invokes this mock with the tool result attached, which then
 * falls through to the tool-answer branch (still SLOW-drippable). One unique
 * natural-language fixture-evidence prompt requests only the fixture MCP tool,
 * and a fixture-only result sentinel selects the fixed sourced answer. A
 * separate unique episodic prompt performs the acceptance chain: search,
 * parse canonical source coordinates from that result, read the exact range,
 * then answer. Ordinary prompts never enter that branch.
 * Requests to /ready serve the Playwright webServer readiness probe.
 */

import http, { type ServerResponse } from "node:http";

const port = Number(process.env.E2E_MODEL_PORT ?? "4303");

const ANSWER_TOKENS = [
  "Mocked",
  " answer",
  " from",
  " the",
  " e2e",
  " model",
  " server",
  ".",
];
const SLOW_TOKEN_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ChatCompletionChunk = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { content?: string };
    finish_reason: "stop" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

function chunk(content: string | undefined, finish: boolean): string {
  const body: ChatCompletionChunk = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: "e2e-mock",
    choices: [
      {
        index: 0,
        delta: content === undefined ? {} : { content },
        finish_reason: finish ? "stop" : null,
      },
    ],
  };
  if (finish) {
    body.usage = {
      prompt_tokens: 10,
      completion_tokens: ANSWER_TOKENS.length,
      total_tokens: 10 + ANSWER_TOKENS.length,
    };
  }
  return `data: ${JSON.stringify(body)}\n\n`;
}

// Distinct answer for the tool-loop path so a test can tell it from the fixed
// non-tool answer above.
const TOOL_ANSWER_TOKENS = [
  "Here",
  " are",
  " the",
  " past",
  " conversations",
  " I",
  " found",
  ".",
];

const CONVERSATION_PROMPT_MARKER = "episodic provenance e2e";
const CONVERSATION_SEARCH_QUERY = "E2E_EPISODIC_SOURCE_MARKER";
const CONVERSATION_ANSWER_TOKENS = [
  "I",
  " read",
  " the",
  " canonical",
  " episodic",
  " source",
  " exactly.",
];

const MCP_TOOL_ID = "mcp__fixture_search__search";
const STDIO_TOOL_ID = "mcp__fixture_local__lookup";
const KNOWLEDGE_SEARCH_TOOL_ID = "knowledge_search";
const KNOWLEDGE_READ_TOOL_ID = "knowledge_read";
const STDIO_PROMPT_MARKER = "local stdio fixture evidence";
const STDIO_RESULT_SENTINEL = "FIXTURE_STDIO_SENTINEL";
const STDIO_ANSWER_TOKENS = [
  "Local",
  " stdio",
  " evidence:",
  " deterministic",
  " local",
  " MCP",
  " lookup",
  " succeeded.",
];
const MCP_PROMPT_MARKER = "current deterministic operator MCP fixture evidence";
const MCP_RESULT_SENTINEL = "FIXTURE_EVIDENCE_SENTINEL";
const MCP_ANSWER_TOKENS = [
  "Current",
  " fixture",
  " evidence:",
  " deterministic",
  " operator",
  " MCP",
  " search",
  " succeeded.",
  " [Fixture source]",
  "(https://fixture.invalid/operator-mcp/current)",
];
const KNOWLEDGE_PROMPT_MARKER = "knowledge fixture";
const KNOWLEDGE_CHANGED_MARKER = "knowledge changed fixture";
const KNOWLEDGE_LONG_PATH = "notes/long-note.md";
const KNOWLEDGE_PAGED_QUERY = "KNOWLEDGE_E2E_PAGED";
const KNOWLEDGE_PAGED_MARKER = "paged literal passages";
const KNOWLEDGE_ERROR_ANSWER_TOKENS = [
  "I",
  " could",
  " not",
  " read",
  " that",
  " Knowledge",
  " note",
  " safely",
  ".",
];

// Structural evidence for arbitrary JSON-shaped values threaded through this
// fixture (request bodies, tool-call arguments, and their JSON-encoded string
// payloads): every parse and lookup below narrows through these instead of an
// inline `typeof`/cast, so the shape is proven once and reused everywhere.
type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<JsonValue>
  | JsonObject;

type JsonObject = { [key: string]: JsonValue };

function isJsonString(value: unknown): value is string {
  return typeof value === "string";
}

function isJsonNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonValue(value: JsonValue): JsonValue {
  if (!isJsonString(value)) return value;
  try {
    // SAFETY: valid JSON text can only ever parse to the string / number /
    // boolean / null / array / object shapes JsonValue enumerates, or throw
    // -- never a value outside that domain.
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

function toolIsOffered(
  tools: Array<JsonValue> | undefined,
  id: string,
): boolean {
  return (
    tools?.some((candidate) => {
      if (!isJsonObject(candidate)) return false;
      const fn = candidate.function;
      return isJsonObject(fn) && fn.name === id;
    }) ?? false
  );
}

/** OpenAI-compatible streaming tool_call delta (AI SDK requires id + type +
 * function.name on the first chunk; full args in one string is valid). */
function toolCallChunk(input: {
  id: string;
  name: string;
  arguments: JsonObject;
}): string {
  const body = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: "e2e-mock",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: input.id,
              type: "function",
              function: {
                name: input.name,
                arguments: JSON.stringify(input.arguments),
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

function toolFinishChunk(): string {
  const body = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: "e2e-mock",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

type ChatMessage = { role?: string; content?: JsonValue };

type ConversationCoordinates = {
  chatId: string;
  messageSeq: number;
  offset: number;
  limit: number;
};

function findStringProperty(value: JsonValue, key: string): string | undefined {
  if (isJsonString(value)) {
    return findStringProperty(parseJsonValue(value), key);
  }
  if (Array.isArray(value)) {
    for (const item of value.toReversed()) {
      const found = findStringProperty(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isJsonObject(value)) return undefined;

  if (isJsonString(value[key])) return value[key];
  for (const item of Object.values(value).toReversed()) {
    const found = findStringProperty(item, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findNumberProperty(value: JsonValue, key: string): number | undefined {
  if (isJsonString(value)) {
    return findNumberProperty(parseJsonValue(value), key);
  }
  if (Array.isArray(value)) {
    for (const item of value.toReversed()) {
      const found = findNumberProperty(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isJsonObject(value)) return undefined;

  if (isJsonNumber(value[key])) return value[key];
  for (const item of Object.values(value).toReversed()) {
    const found = findNumberProperty(item, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findSearchResult(value: JsonValue): JsonObject | undefined {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    for (const item of parsed.toReversed()) {
      const found = findSearchResult(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isJsonObject(parsed)) return undefined;

  if (parsed.status === "success" && Array.isArray(parsed.results)) {
    return parsed;
  }
  for (const item of Object.values(parsed).toReversed()) {
    const found = findSearchResult(item);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findCanonicalCoordinates(
  value: JsonValue,
): ConversationCoordinates | undefined {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    for (const item of parsed.toReversed()) {
      const found = findCanonicalCoordinates(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isJsonObject(parsed)) return undefined;

  if (
    parsed.kind === "content" &&
    isJsonString(parsed.chatId) &&
    isJsonNumber(parsed.messageSeq) &&
    isJsonNumber(parsed.offset) &&
    isJsonNumber(parsed.limit)
  ) {
    return {
      chatId: parsed.chatId,
      messageSeq: parsed.messageSeq,
      offset: parsed.offset,
      limit: parsed.limit,
    };
  }
  for (const item of Object.values(parsed).toReversed()) {
    const found = findCanonicalCoordinates(item);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findConversationReadResult(value: JsonValue): boolean {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    return parsed.some(findConversationReadResult);
  }
  if (!isJsonObject(parsed)) return false;

  if (parsed.status === "success" && isJsonString(parsed.content)) {
    return true;
  }
  return Object.values(parsed).some(findConversationReadResult);
}

/** Classify native and fixture-MCP tool-loop requests independently. */
/**
 * Which knowledge-fixture scenario a prompt is asking for.
 *
 * Separate from `classify` because it answers a different question: `classify`
 * reads the REQUEST SHAPE (what tools were offered, which messages came back),
 * while this reads the PROMPT TEXT to pick a scenario. The two only meet in the
 * returned record.
 */
function classifyKnowledgeRequest(content: string) {
  const ERROR_SCENARIOS = [
    "traversal",
    "symlink",
    "oversized",
    "missing",
    "unavailable",
  ];
  // Ordered: the first matching scenario names the fixture file to read.
  const READ_PATHS: ReadonlyArray<readonly [string, string]> = [
    ["traversal", "../outside.md"],
    ["symlink", "notes/link.md"],
    ["oversized", "notes/oversized.md"],
    ["missing", "notes/missing.md"],
    ["long knowledge", KNOWLEDGE_LONG_PATH],
  ];

  const asksKnowledge =
    content.includes(KNOWLEDGE_PROMPT_MARKER) ||
    content.includes(KNOWLEDGE_CHANGED_MARKER) ||
    content.includes("long knowledge fixture") ||
    ERROR_SCENARIOS.some((scenario) =>
      content.includes(`knowledge ${scenario}`),
    );

  const operation = ERROR_SCENARIOS.some((scenario) =>
    content.includes(scenario),
  )
    ? "error"
    : content.includes("read")
      ? "read"
      : "search";

  return {
    asksKnowledge,
    operation,
    readPath:
      READ_PATHS.find(([marker]) => content.includes(marker))?.[1] ??
      "notes/worker-note.md",
    spaceId: /Knowledge Space ID: ([0-9a-f-]{36})/iu.exec(content)?.[1],
  };
}

function classify(raw: string) {
  try {
    // SAFETY: raw is this fixture's own /chat/completions request body --
    // the api's OpenAI-compatible client, whose {tools, messages} shape is
    // fixed by the AI SDK request format this mock exists to answer.
    const body = JSON.parse(raw) as {
      tools?: Array<JsonValue>;
      messages?: Array<ChatMessage>;
    };
    const messages = body.messages ?? [];
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const hasToolResult = messages.some((m) => m.role === "tool");
    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
    const content = isJsonString(lastUser?.content)
      ? lastUser.content
      : JSON.stringify(lastUser?.content ?? "");
    const currentTurnToolResultCount =
      lastUserIndex < 0
        ? 0
        : messages
            .slice(lastUserIndex + 1)
            .filter((message) => message.role === "tool").length;
    const currentTurnMessages =
      lastUserIndex < 0 ? [] : messages.slice(lastUserIndex + 1);
    const hasCurrentTurnToolResult = currentTurnToolResultCount > 0;
    const latestToolContent = messages.findLast(
      (m) => m.role === "tool",
    )?.content;
    const knowledgeResultPath = findStringProperty(
      messages.slice(lastUserIndex + 1).findLast((m) => m.role === "tool")
        ?.content,
      "path",
    );
    const knowledge = classifyKnowledgeRequest(content);
    return {
      hasTools,
      hasToolResult,
      hasCurrentTurnToolResult,
      currentTurnToolResultCount,
      asksSearch: /\bsearch\b/i.test(content),
      asksMcpFixtureSearch: content.includes(MCP_PROMPT_MARKER),
      hasMcpFixtureTool: toolIsOffered(body.tools, MCP_TOOL_ID),
      hasMcpFixtureResult: raw.includes(MCP_RESULT_SENTINEL),
      asksStdioFixture: content.includes(STDIO_PROMPT_MARKER),
      hasStdioFixtureResult: raw.includes(STDIO_RESULT_SENTINEL),
      asksKnowledge: knowledge.asksKnowledge,
      hasKnowledgeSearchTool: toolIsOffered(
        body.tools,
        KNOWLEDGE_SEARCH_TOOL_ID,
      ),
      hasKnowledgeReadTool: toolIsOffered(body.tools, KNOWLEDGE_READ_TOOL_ID),
      asksConversationRecall: content.includes(CONVERSATION_PROMPT_MARKER),
      hasConversationTools:
        toolIsOffered(body.tools, "search_conversations") &&
        toolIsOffered(body.tools, "conversation_read"),
      hasConversationSearchResult:
        findSearchResult(currentTurnMessages) !== undefined,
      hasConversationReadResult:
        findConversationReadResult(currentTurnMessages),
      conversationNextOffset: findNumberProperty(
        latestToolContent,
        "nextOffset",
      ),
      knowledgeOperation: knowledge.operation,
      knowledgeSpaceId: knowledge.spaceId,
      knowledgeReadPath: knowledge.readPath,
      knowledgeNextOffset: findNumberProperty(latestToolContent, "nextOffset"),
      knowledgeCursor: findStringProperty(latestToolContent, "nextCursor"),
      knowledgeResultPath,
      lastUserContent: content,
    };
  } catch {
    return {
      hasTools: false,
      hasToolResult: false,
      hasCurrentTurnToolResult: false,
      currentTurnToolResultCount: 0,
      asksSearch: false,
      asksMcpFixtureSearch: false,
      hasMcpFixtureTool: false,
      hasMcpFixtureResult: false,
      asksStdioFixture: false,
      hasStdioFixtureResult: false,
      asksKnowledge: false,
      hasKnowledgeSearchTool: false,
      hasKnowledgeReadTool: false,
      asksConversationRecall: false,
      hasConversationTools: false,
      hasConversationSearchResult: false,
      hasConversationReadResult: false,
      conversationNextOffset: undefined,
      knowledgeOperation: "search",
      knowledgeSpaceId: undefined,
      knowledgeReadPath: "notes/worker-note.md",
      knowledgeNextOffset: undefined,
      knowledgeCursor: undefined,
      knowledgeResultPath: undefined,
      lastUserContent: "",
    };
  }
}

type Classification = ReturnType<typeof classify>;

// Every fixture branch below reads from one classification plus the two
// derived knowledge-routing flags every knowledge branch shares, so each
// `tryXxx` handler takes exactly this and nothing else.
type ChunkContext = Classification & {
  res: ServerResponse;
  raw: string;
  readKnowledge: boolean;
  hasRequestedKnowledgeTool: boolean;
};

function writeSseHead(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

function writeToolCall(
  res: ServerResponse,
  call: { id: string; name: string; arguments: JsonObject },
): void {
  res.write(toolCallChunk(call));
  res.write(toolFinishChunk());
  res.write("data: [DONE]\n\n");
  res.end();
}

function writeAnswer(res: ServerResponse, tokens: ReadonlyArray<string>): void {
  for (const token of tokens) {
    res.write(chunk(token, false));
  }
  res.write(chunk(undefined, true));
  res.write("data: [DONE]\n\n");
  res.end();
}

// Episodic acceptance chain. The second and third calls are built from the
// canonical search result itself; the model fixture never knows a message
// UUID, part identity, hash, or version. Kept independent from the ordinary
// "search" fixture below so generic prompts cannot accidentally gain a
// second tool call.
function tryConversationSearchTurn(ctx: ChunkContext): boolean {
  if (
    !ctx.asksConversationRecall ||
    !ctx.hasConversationTools ||
    ctx.hasConversationSearchResult
  ) {
    return false;
  }
  writeToolCall(ctx.res, {
    id: "call_conversation_search_e2e",
    name: "search_conversations",
    arguments: { query: CONVERSATION_SEARCH_QUERY, limit: 5 },
  });
  return true;
}

function tryConversationReadTurn(ctx: ChunkContext): boolean {
  if (
    !ctx.asksConversationRecall ||
    !ctx.hasConversationTools ||
    !ctx.hasConversationSearchResult ||
    ctx.hasConversationReadResult
  ) {
    return false;
  }
  const coordinates = findCanonicalCoordinates(ctx.raw);
  if (coordinates === undefined) return false;
  writeToolCall(ctx.res, {
    id: "call_conversation_read_e2e",
    name: "conversation_read",
    arguments: coordinates,
  });
  return true;
}

function tryConversationReadContinuationOrAnswer(ctx: ChunkContext): boolean {
  if (!ctx.asksConversationRecall || !ctx.hasConversationTools) return false;
  if (!ctx.hasConversationReadResult) return false;

  if (
    ctx.conversationNextOffset !== undefined &&
    ctx.currentTurnToolResultCount === 2
  ) {
    const coordinates = findCanonicalCoordinates(ctx.raw);
    if (coordinates !== undefined) {
      writeToolCall(ctx.res, {
        id: "call_conversation_read_continue_e2e",
        name: "conversation_read",
        arguments: { ...coordinates, offset: ctx.conversationNextOffset },
      });
      return true;
    }
  }
  writeAnswer(ctx.res, CONVERSATION_ANSWER_TOKENS);
  return true;
}

// No explicit return-type annotation: each field is set to `undefined` when
// absent rather than the key being conditionally omitted, so toolCallChunk's
// JSON.stringify drops it exactly as an omitted key would, without a spread
// that hides the omission behind an empty object.
function knowledgeReadArguments(ctx: ChunkContext) {
  const explicitRange = ctx.lastUserContent.includes("explicit range");
  return {
    knowledgeSpaceId: ctx.knowledgeSpaceId,
    path: ctx.knowledgeReadPath,
    offset: explicitRange ? 2 : undefined,
    limit: explicitRange ? 3 : undefined,
  };
}

function knowledgeSearchArguments(ctx: ChunkContext) {
  const includeSpaceId =
    (ctx.lastUserContent.includes("explicit") ||
      ctx.lastUserContent.includes(KNOWLEDGE_PAGED_MARKER)) &&
    ctx.knowledgeSpaceId !== undefined;
  const includeCursor =
    ctx.lastUserContent.includes("next page") &&
    ctx.knowledgeCursor !== undefined;
  return {
    query: ctx.lastUserContent.includes(KNOWLEDGE_PAGED_MARKER)
      ? KNOWLEDGE_PAGED_QUERY
      : ctx.lastUserContent.includes(KNOWLEDGE_CHANGED_MARKER)
        ? "KNOWLEDGE_E2E_CHANGED"
        : "KNOWLEDGE_E2E_MARKER",
    limit: ctx.lastUserContent.includes(KNOWLEDGE_PAGED_MARKER) ? 1 : 5,
    knowledgeSpaceId: includeSpaceId ? ctx.knowledgeSpaceId : undefined,
    cursor: includeCursor ? ctx.knowledgeCursor : undefined,
  };
}

function tryKnowledgeFirstTurn(ctx: ChunkContext): boolean {
  if (
    !ctx.asksKnowledge ||
    !ctx.hasRequestedKnowledgeTool ||
    ctx.hasCurrentTurnToolResult
  ) {
    return false;
  }
  writeToolCall(ctx.res, {
    id: ctx.readKnowledge
      ? `call_knowledge_read_${ctx.knowledgeReadPath.replaceAll(/[^a-z]/g, "_")}_e2e`
      : ctx.lastUserContent.includes(KNOWLEDGE_CHANGED_MARKER)
        ? "call_knowledge_search_changed_e2e"
        : "call_knowledge_search_e2e",
    name: ctx.readKnowledge ? KNOWLEDGE_READ_TOOL_ID : KNOWLEDGE_SEARCH_TOOL_ID,
    arguments: ctx.readKnowledge
      ? knowledgeReadArguments(ctx)
      : knowledgeSearchArguments(ctx),
  });
  return true;
}

function tryKnowledgeContinuationTurn(ctx: ChunkContext): boolean {
  const matches =
    ctx.asksKnowledge &&
    ctx.hasRequestedKnowledgeTool &&
    ctx.currentTurnToolResultCount === 1 &&
    ((ctx.readKnowledge &&
      ctx.lastUserContent.includes("long knowledge fixture") &&
      !ctx.lastUserContent.includes("explicit range") &&
      ctx.knowledgeNextOffset !== undefined) ||
      (!ctx.readKnowledge &&
        ctx.lastUserContent.includes(KNOWLEDGE_PAGED_MARKER) &&
        ctx.knowledgeCursor !== undefined));
  if (!matches) return false;

  writeToolCall(ctx.res, {
    id: ctx.readKnowledge
      ? "call_knowledge_read_continued_e2e"
      : "call_knowledge_search_continued_e2e",
    name: ctx.readKnowledge ? KNOWLEDGE_READ_TOOL_ID : KNOWLEDGE_SEARCH_TOOL_ID,
    arguments: ctx.readKnowledge
      ? {
          knowledgeSpaceId: ctx.knowledgeSpaceId,
          path: ctx.knowledgeReadPath,
          offset: ctx.knowledgeNextOffset,
          limit: 2000,
        }
      : {
          query: KNOWLEDGE_PAGED_QUERY,
          limit: 1,
          knowledgeSpaceId: ctx.knowledgeSpaceId,
          cursor: ctx.knowledgeCursor,
        },
  });
  return true;
}

function tryKnowledgeCompletionAnswer(ctx: ChunkContext): boolean {
  if (
    !ctx.asksKnowledge ||
    !ctx.hasRequestedKnowledgeTool ||
    !ctx.hasCurrentTurnToolResult
  ) {
    return false;
  }
  const tokens =
    ctx.knowledgeOperation === "error"
      ? KNOWLEDGE_ERROR_ANSWER_TOKENS
      : [
          "I",
          " found",
          ctx.lastUserContent.includes(KNOWLEDGE_CHANGED_MARKER)
            ? " the changed"
            : " the",
          " note",
          " at",
          ` ${ctx.knowledgeResultPath ?? "[missing Knowledge result path]"}`,
          ".",
        ];
  writeAnswer(ctx.res, tokens);
  return true;
}

// MCP acceptance first turn. It must have both the unique user marker and
// the exact offered dynamic tool, so it cannot affect native search or
// answer-only browser cases.
function tryMcpFixtureFirstTurn(ctx: ChunkContext): boolean {
  if (
    !ctx.hasMcpFixtureTool ||
    !ctx.asksMcpFixtureSearch ||
    ctx.hasToolResult
  ) {
    return false;
  }
  writeToolCall(ctx.res, {
    id: "call_mcp_search_e2e",
    name: MCP_TOOL_ID,
    arguments: { query: "current operator MCP fixture evidence" },
  });
  return true;
}

// Local stdio acceptance, gated on its own unique marker so it cannot affect
// the remote-MCP, native-search, or answer-only cases.
function tryStdioFixtureFirstTurn(ctx: ChunkContext): boolean {
  if (!ctx.asksStdioFixture || ctx.hasToolResult) return false;
  writeToolCall(ctx.res, {
    id: "call_stdio_lookup_e2e",
    name: STDIO_TOOL_ID,
    arguments: { query: "local stdio fixture evidence" },
  });
  return true;
}

function tryStdioFixtureResultAnswer(ctx: ChunkContext): boolean {
  if (!ctx.hasStdioFixtureResult) return false;
  writeAnswer(ctx.res, STDIO_ANSWER_TOKENS);
  return true;
}

function tryMcpFixtureResultAnswer(ctx: ChunkContext): boolean {
  if (!ctx.hasMcpFixtureResult) return false;
  writeAnswer(ctx.res, MCP_ANSWER_TOKENS);
  return true;
}

// Native tool-loop first turn: the real DB-backed search is unchanged.
function tryNativeToolLoopFirstTurn(ctx: ChunkContext): boolean {
  if (
    ctx.asksMcpFixtureSearch ||
    ctx.asksStdioFixture ||
    ctx.asksConversationRecall ||
    !ctx.hasTools ||
    !ctx.asksSearch ||
    ctx.hasToolResult
  ) {
    return false;
  }
  writeToolCall(ctx.res, {
    id: "call_search_e2e",
    name: "search_conversations",
    arguments: { query: "budget" },
  });
  return true;
}

async function writeDefaultAnswer(ctx: ChunkContext): Promise<void> {
  const slow = ctx.raw.includes("SLOW");
  const tokens = ctx.hasToolResult ? TOOL_ANSWER_TOKENS : ANSWER_TOKENS;
  // A disconnected peer mid-drip must not crash the mock (an unhandled
  // stream error would take down every later test's model backend).
  ctx.res.on("error", () => {});
  for (const token of tokens) {
    if (ctx.res.destroyed) {
      return;
    }
    ctx.res.write(chunk(token, false));
    if (slow) {
      await sleep(SLOW_TOKEN_DELAY_MS);
    }
  }
  ctx.res.write(chunk(undefined, true));
  ctx.res.write("data: [DONE]\n\n");
  ctx.res.end();
}

async function respondToChatCompletion(
  res: ServerResponse,
  raw: string,
): Promise<void> {
  // The api's post-turn title generation hits this mock too — answer it with
  // a distinct short title so tests can tell title from message.
  if (raw.includes("Generate a short chat title")) {
    writeSseHead(res);
    res.write(chunk("E2E Mock Title", false));
    res.write(chunk(undefined, true));
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const classification = classify(raw);
  const readKnowledge =
    classification.knowledgeOperation === "read" ||
    classification.knowledgeOperation === "error";
  const hasRequestedKnowledgeTool = readKnowledge
    ? classification.hasKnowledgeReadTool
    : classification.hasKnowledgeSearchTool;
  const ctx = {
    ...classification,
    res,
    raw,
    readKnowledge,
    hasRequestedKnowledgeTool,
  };

  writeSseHead(res);

  if (tryConversationSearchTurn(ctx)) return;
  if (tryConversationReadTurn(ctx)) return;
  if (tryConversationReadContinuationOrAnswer(ctx)) return;

  if (tryKnowledgeFirstTurn(ctx)) return;
  if (tryKnowledgeContinuationTurn(ctx)) return;
  if (tryKnowledgeCompletionAnswer(ctx)) return;

  if (tryMcpFixtureFirstTurn(ctx)) return;
  if (tryStdioFixtureFirstTurn(ctx)) return;
  if (tryStdioFixtureResultAnswer(ctx)) return;
  if (tryMcpFixtureResultAnswer(ctx)) return;

  if (tryNativeToolLoopFirstTurn(ctx)) return;

  await writeDefaultAnswer(ctx);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/ready") {
    res.writeHead(200).end("ok");
    return;
  }

  if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (part: Buffer) => {
      raw += part.toString();
    });
    req.on("end", () => {
      void respondToChatCompletion(res, raw);
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`[e2e model server] listening on :${port}`);
});
