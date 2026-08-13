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

/** Classify native and fixture-MCP tool-loop requests independently. */
function classify(raw: string): {
  hasTools: boolean;
  hasToolResult: boolean;
  asksSearch: boolean;
  asksMcpFixtureSearch: boolean;
  hasMcpFixtureTool: boolean;
  hasMcpFixtureResult: boolean;
} {
  try {
    const body = JSON.parse(raw) as {
      tools?: unknown[];
      messages?: ChatMessage[];
    };
    const messages = body.messages ?? [];
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const hasToolResult = messages.some((m) => m.role === "tool");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const content =
      typeof lastUser?.content === "string"
        ? lastUser.content
        : JSON.stringify(lastUser?.content ?? "");
    const hasMcpFixtureTool = body.tools?.some((candidate) => {
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
        (fn as { name?: unknown }).name === MCP_TOOL_ID
      );
    });
    return {
      hasTools,
      hasToolResult,
      asksSearch: /\bsearch\b/i.test(content),
      asksMcpFixtureSearch: content.includes(MCP_PROMPT_MARKER),
      hasMcpFixtureTool: hasMcpFixtureTool === true,
      hasMcpFixtureResult: raw.includes(MCP_RESULT_SENTINEL),
      asksStdioFixture: content.includes(STDIO_PROMPT_MARKER),
      hasStdioFixtureResult: raw.includes(STDIO_RESULT_SENTINEL),
    };
  } catch {
    return {
      hasTools: false,
      hasToolResult: false,
      asksSearch: false,
      asksMcpFixtureSearch: false,
      hasMcpFixtureTool: false,
      hasMcpFixtureResult: false,
      asksStdioFixture: false,
      hasStdioFixtureResult: false,
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
        } = classify(raw);

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

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
