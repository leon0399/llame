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
 * and a fixture-only result sentinel selects the fixed sourced answer.
 * Requests to /ready serve the Playwright webServer readiness probe.
 */

import http from "node:http";

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

function chunk(content: string | undefined, finish: boolean): string {
  const body = {
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
    ...(finish
      ? {
          usage: {
            prompt_tokens: 10,
            completion_tokens: ANSWER_TOKENS.length,
            total_tokens: 10 + ANSWER_TOKENS.length,
          },
        }
      : {}),
  };
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

function toolIsOffered(tools: unknown[] | undefined, id: string): boolean {
  return (
    tools?.some((candidate) => {
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        return false;
      }
      const fn = (candidate as { function?: unknown }).function;
      return (
        fn !== null &&
        typeof fn === "object" &&
        !Array.isArray(fn) &&
        (fn as { name?: unknown }).name === id
      );
    }) ?? false
  );
}

/** OpenAI-compatible streaming tool_call delta (AI SDK requires id + type +
 * function.name on the first chunk; full args in one string is valid). */
function toolCallChunk(input: {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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

type ChatMessage = { role?: string; content?: unknown };

function findStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value === "string") {
    try {
      return findStringProperty(JSON.parse(value) as unknown, key);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value.toReversed()) {
      const found = findStringProperty(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record[key] === "string") return record[key];
  for (const item of Object.values(record).toReversed()) {
    const found = findStringProperty(item, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value === "string") {
    try {
      return findNumberProperty(JSON.parse(value) as unknown, key);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value.toReversed()) {
      const found = findNumberProperty(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record[key] === "number") return record[key];
  for (const item of Object.values(record).toReversed()) {
    const found = findNumberProperty(item, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Classify native and fixture-MCP tool-loop requests independently. */
function classify(raw: string): {
  hasTools: boolean;
  hasToolResult: boolean;
  hasCurrentTurnToolResult: boolean;
  currentTurnToolResultCount: number;
  asksSearch: boolean;
  asksMcpFixtureSearch: boolean;
  hasMcpFixtureTool: boolean;
  hasMcpFixtureResult: boolean;
  asksStdioFixture: boolean;
  hasStdioFixtureResult: boolean;
  asksKnowledge: boolean;
  hasKnowledgeSearchTool: boolean;
  hasKnowledgeReadTool: boolean;
  knowledgeOperation: "search" | "read" | "error";
  knowledgeSpaceId: string | undefined;
  knowledgeReadPath: string;
  knowledgeNextOffset: number | undefined;
  knowledgeCursor: string | undefined;
  knowledgeResultPath: string | undefined;
  lastUserContent: string;
} {
  try {
    const body = JSON.parse(raw) as {
      tools?: unknown[];
      messages?: ChatMessage[];
    };
    const messages = body.messages ?? [];
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const hasToolResult = messages.some((m) => m.role === "tool");
    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
    const content =
      typeof lastUser?.content === "string"
        ? lastUser.content
        : JSON.stringify(lastUser?.content ?? "");
    const currentTurnToolResultCount =
      lastUserIndex < 0
        ? 0
        : messages
            .slice(lastUserIndex + 1)
            .filter((message) => message.role === "tool").length;
    const hasCurrentTurnToolResult = currentTurnToolResultCount > 0;
    const latestToolContent = messages.findLast(
      (m) => m.role === "tool",
    )?.content;
    const knowledgeResultPath = findStringProperty(
      messages.slice(lastUserIndex + 1).findLast((m) => m.role === "tool")
        ?.content,
      "path",
    );
    const knowledgeReadPath = content.includes("traversal")
      ? "../outside.md"
      : content.includes("symlink")
        ? "notes/link.md"
        : content.includes("oversized")
          ? "notes/oversized.md"
          : content.includes("missing")
            ? "notes/missing.md"
            : content.includes("long knowledge")
              ? KNOWLEDGE_LONG_PATH
              : "notes/worker-note.md";
    const knowledgeSpaceId = /Knowledge Space ID: ([0-9a-f-]{36})/iu.exec(
      content,
    )?.[1];
    const knowledgeOperation =
      content.includes("traversal") ||
      content.includes("symlink") ||
      content.includes("oversized") ||
      content.includes("missing") ||
      content.includes("unavailable")
        ? "error"
        : content.includes("read")
          ? "read"
          : "search";
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
      asksKnowledge:
        content.includes(KNOWLEDGE_PROMPT_MARKER) ||
        content.includes(KNOWLEDGE_CHANGED_MARKER) ||
        content.includes("long knowledge fixture") ||
        content.includes("knowledge traversal") ||
        content.includes("knowledge symlink") ||
        content.includes("knowledge oversized") ||
        content.includes("knowledge missing") ||
        content.includes("knowledge unavailable"),
      hasKnowledgeSearchTool: toolIsOffered(
        body.tools,
        KNOWLEDGE_SEARCH_TOOL_ID,
      ),
      hasKnowledgeReadTool: toolIsOffered(body.tools, KNOWLEDGE_READ_TOOL_ID),
      knowledgeOperation,
      knowledgeSpaceId,
      knowledgeReadPath,
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
      void (async () => {
        // The api's post-turn title generation hits this mock too — answer it
        // with a distinct short title so tests can tell title from message.
        if (raw.includes("Generate a short chat title")) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(chunk("E2E Mock Title", false));
          res.write(chunk(undefined, true));
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        const {
          hasTools,
          hasToolResult,
          asksSearch,
          asksMcpFixtureSearch,
          hasMcpFixtureTool,
          hasMcpFixtureResult,
          asksStdioFixture,
          hasStdioFixtureResult,
          asksKnowledge,
          hasKnowledgeSearchTool,
          hasKnowledgeReadTool,
          hasCurrentTurnToolResult,
          currentTurnToolResultCount,
          knowledgeOperation,
          knowledgeSpaceId,
          knowledgeReadPath,
          knowledgeNextOffset,
          knowledgeCursor,
          knowledgeResultPath,
          lastUserContent,
        } = classify(raw);

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        const readKnowledge =
          knowledgeOperation === "read" || knowledgeOperation === "error";
        const hasRequestedKnowledgeTool = readKnowledge
          ? hasKnowledgeReadTool
          : hasKnowledgeSearchTool;
        if (
          asksKnowledge &&
          hasRequestedKnowledgeTool &&
          !hasCurrentTurnToolResult
        ) {
          res.write(
            toolCallChunk({
              id: readKnowledge
                ? `call_knowledge_read_${knowledgeReadPath.replaceAll(/[^a-z]/g, "_")}_e2e`
                : lastUserContent.includes(KNOWLEDGE_CHANGED_MARKER)
                  ? "call_knowledge_search_changed_e2e"
                  : "call_knowledge_search_e2e",
              name: readKnowledge
                ? KNOWLEDGE_READ_TOOL_ID
                : KNOWLEDGE_SEARCH_TOOL_ID,
              arguments: readKnowledge
                ? {
                    knowledgeSpaceId,
                    path: knowledgeReadPath,
                    ...(lastUserContent.includes("explicit range")
                      ? { offset: 2, limit: 3 }
                      : {}),
                  }
                : {
                    query: lastUserContent.includes(KNOWLEDGE_PAGED_MARKER)
                      ? KNOWLEDGE_PAGED_QUERY
                      : lastUserContent.includes(KNOWLEDGE_CHANGED_MARKER)
                        ? "KNOWLEDGE_E2E_CHANGED"
                        : "KNOWLEDGE_E2E_MARKER",
                    limit: lastUserContent.includes(KNOWLEDGE_PAGED_MARKER)
                      ? 1
                      : 5,
                    ...((lastUserContent.includes("explicit") ||
                      lastUserContent.includes(KNOWLEDGE_PAGED_MARKER)) &&
                    knowledgeSpaceId !== undefined
                      ? { knowledgeSpaceId }
                      : {}),
                    ...(lastUserContent.includes("next page") &&
                    knowledgeCursor !== undefined
                      ? { cursor: knowledgeCursor }
                      : {}),
                  },
            }),
          );
          res.write(toolFinishChunk());
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        if (
          asksKnowledge &&
          hasRequestedKnowledgeTool &&
          currentTurnToolResultCount === 1 &&
          ((readKnowledge &&
            lastUserContent.includes("long knowledge fixture") &&
            !lastUserContent.includes("explicit range") &&
            knowledgeNextOffset !== undefined) ||
            (!readKnowledge &&
              lastUserContent.includes(KNOWLEDGE_PAGED_MARKER) &&
              knowledgeCursor !== undefined))
        ) {
          res.write(
            toolCallChunk({
              id: readKnowledge
                ? "call_knowledge_read_continued_e2e"
                : "call_knowledge_search_continued_e2e",
              name: readKnowledge
                ? KNOWLEDGE_READ_TOOL_ID
                : KNOWLEDGE_SEARCH_TOOL_ID,
              arguments: readKnowledge
                ? {
                    knowledgeSpaceId,
                    path: knowledgeReadPath,
                    offset: knowledgeNextOffset,
                    limit: 2_000,
                  }
                : {
                    query: KNOWLEDGE_PAGED_QUERY,
                    limit: 1,
                    knowledgeSpaceId,
                    cursor: knowledgeCursor,
                  },
            }),
          );
          res.write(toolFinishChunk());
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        if (
          asksKnowledge &&
          hasRequestedKnowledgeTool &&
          hasCurrentTurnToolResult
        ) {
          const tokens =
            knowledgeOperation === "error"
              ? KNOWLEDGE_ERROR_ANSWER_TOKENS
              : [
                  "I",
                  " found",
                  lastUserContent.includes(KNOWLEDGE_CHANGED_MARKER)
                    ? " the changed"
                    : " the",
                  " note",
                  " at",
                  ` ${knowledgeResultPath ?? "[missing Knowledge result path]"}`,
                  ".",
                ];
          for (const token of tokens) {
            res.write(chunk(token, false));
          }
          res.write(chunk(undefined, true));
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        // MCP acceptance first turn. It must have both the unique user marker
        // and the exact offered dynamic tool, so it cannot affect native
        // search or answer-only browser cases.
        if (hasMcpFixtureTool && asksMcpFixtureSearch && !hasToolResult) {
          res.write(
            toolCallChunk({
              id: "call_mcp_search_e2e",
              name: MCP_TOOL_ID,
              arguments: { query: "current operator MCP fixture evidence" },
            }),
          );
          res.write(toolFinishChunk());
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        // Local stdio acceptance, gated on its own unique marker so it cannot
        // affect the remote-MCP, native-search, or answer-only cases.
        if (asksStdioFixture && !hasToolResult) {
          res.write(
            toolCallChunk({
              id: "call_stdio_lookup_e2e",
              name: STDIO_TOOL_ID,
              arguments: { query: "local stdio fixture evidence" },
            }),
          );
          res.write(toolFinishChunk());
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        if (hasStdioFixtureResult) {
          for (const token of STDIO_ANSWER_TOKENS) {
            res.write(chunk(token, false));
          }
          res.write(chunk(undefined, true));
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        if (hasMcpFixtureResult) {
          for (const token of MCP_ANSWER_TOKENS) {
            res.write(chunk(token, false));
          }
          res.write(chunk(undefined, true));
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        // Native tool-loop first turn: the real DB-backed search is unchanged.
        if (
          !asksMcpFixtureSearch &&
          !asksStdioFixture &&
          hasTools &&
          asksSearch &&
          !hasToolResult
        ) {
          res.write(
            toolCallChunk({
              id: "call_search_e2e",
              name: "search_conversations",
              arguments: { query: "budget" },
            }),
          );
          res.write(toolFinishChunk());
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        const slow = raw.includes("SLOW");
        const tokens = hasToolResult ? TOOL_ANSWER_TOKENS : ANSWER_TOKENS;
        // A disconnected peer mid-drip must not crash the mock (an unhandled
        // stream error would take down every later test's model backend).
        res.on("error", () => {});
        for (const token of tokens) {
          if (res.destroyed) {
            return;
          }
          res.write(chunk(token, false));
          if (slow) {
            await sleep(SLOW_TOKEN_DELAY_MS);
          }
        }
        res.write(chunk(undefined, true));
        res.write("data: [DONE]\n\n");
        res.end();
      })();
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`[e2e model server] listening on :${port}`);
});
