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
 * proof); anything else streams immediately. Requests to /ready serve the
 * Playwright webServer readiness probe.
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

/**
 * Append-only log of the credentials + model ids the api actually sent on
 * real chat calls (title-gen excluded). The BYOK browser test asserts its
 * OWN (distinct per-worker) key + model appear here — proof the vault
 * decrypted the stored key and the selected model reached the provider,
 * not the instance fallback. Append-only (not last-write) so parallel
 * workers hitting the shared mock never race. Capped to bound memory.
 */
type SeenRequest = { authorization: string; model: string };
const seenChatRequests: SeenRequest[] = [];
const SEEN_CAP = 500;

function recordChatRequest(authorization: string, model: string): void {
  seenChatRequests.push({ authorization, model });
  if (seenChatRequests.length > SEEN_CAP) {
    seenChatRequests.shift();
  }
}

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
  " is",
  " the",
  " current",
  " time",
  " you",
  " requested",
  ".",
];

/** OpenAI-compatible streaming tool_call delta (AI SDK requires id + type +
 * function.name on the first chunk; full args in one string is valid). */
function toolCallChunk(): string {
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
              id: "call_time_e2e",
              type: "function",
              function: {
                name: "get_current_time",
                arguments: JSON.stringify({ timezone: "UTC" }),
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

/**
 * Classify a chat request for the tool-loop path. Triple-gated so it can never
 * affect existing tests: the request must carry a tool set, the LAST USER
 * message must mention "time" (word boundary — not "sometimes"/"lifetime"),
 * and there must be no prior tool result (that's the follow-up turn).
 */
function classify(raw: string): {
  hasTools: boolean;
  hasToolResult: boolean;
  asksTime: boolean;
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
    return { hasTools, hasToolResult, asksTime: /\btime\b/i.test(content) };
  } catch {
    return { hasTools: false, hasToolResult: false, asksTime: false };
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/ready") {
    res.writeHead(200).end("ok");
    return;
  }

  // BYOK test introspection: the credentials + models seen on real chat calls.
  if (req.method === "GET" && req.url === "/requests") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(seenChatRequests));
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

        // Record the real chat call's credential + model for the BYOK test.
        let requestedModel = "unknown";
        try {
          requestedModel =
            (JSON.parse(raw) as { model?: string }).model ?? "unknown";
        } catch {
          // non-JSON body — leave as unknown
        }
        recordChatRequest(req.headers.authorization ?? "", requestedModel);

        const { hasTools, hasToolResult, asksTime } = classify(raw);

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        // Tool-loop first turn: the model calls get_current_time. The AI SDK
        // executes it and sends a follow-up (now carrying a role:'tool'
        // result), which falls through to the tool-answer branch below.
        if (hasTools && asksTime && !hasToolResult) {
          res.write(toolCallChunk());
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
