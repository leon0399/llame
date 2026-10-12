import { describe, expect, it } from "vitest";

import { chatToMarkdown, slugifyTitle } from "./chat-markdown";
import type { ChatMessageResponse } from "./history";

// Minimal ChatMessageResponse-shaped fixtures (only the fields the renderer
// reads). `parts` stays `unknown[]`, not `UIMessage["parts"]`: these fixtures
// deliberately include non-standard/internal part shapes to prove the
// renderer ignores anything that isn't `text`/`reasoning` — matching
// `partsText`'s own `parts: unknown` signature in chat-markdown.ts.
type MsgOverrides = Omit<Partial<ChatMessageResponse>, "parts"> & {
  parts?: Array<unknown>;
};

const msg = (over: MsgOverrides) => {
  const base = {
    id: "m",
    chatId: "c",
    seq: 1,
    senderUserId: null,
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: "2026-07-03T00:00:00Z",
    ...over,
  };
  // SAFETY: every call site in this file supplies `role` and `parts`
  // through `over` — the two `ChatMessageResponse` fields this base literal
  // omits — but `Partial<ChatMessageResponse>` can't prove that statically
  // since every field there is optional.
  return base as never;
};

describe("chatToMarkdown", () => {
  it("renders user + assistant turns with headings and text", () => {
    const md = chatToMarkdown(
      "My Chat",
      [
        msg({ role: "user", parts: [{ type: "text", text: "hi" }] }),
        msg({
          role: "assistant",
          parts: [{ type: "text", text: "hello" }],
          usage: { modelId: "system:openai:gpt-4o" },
        }),
      ],
      [
        {
          id: "system:openai:gpt-4o",
          source: "system",
          name: "GPT-4o",
          contextWindowTokens: 128_000,
          input: ["text"],
        },
      ],
    );
    expect(md).toContain("# My Chat");
    expect(md).toContain("**You**\n\nhi");
    expect(md).toContain("**Assistant** · GPT-4o\n\nhello");
    expect(md).toContain("\n---\n"); // separator between turns
  });

  it("falls back to the opaque id for an unrecognized model id", () => {
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [{ type: "text", text: "hi" }],
        usage: { modelId: "custom:unknown-model" },
      }),
    ]);
    expect(md).toContain("**Assistant** · custom:unknown-model");
  });

  it("resolves a loaded API model id", () => {
    const md = chatToMarkdown(
      "T",
      [
        msg({
          role: "assistant",
          parts: [{ type: "text", text: "hi" }],
          usage: { modelId: "system:openai:gpt-4o" },
        }),
      ],
      [
        {
          id: "system:openai:gpt-4o",
          source: "system",
          name: "GPT-4o",
          contextWindowTokens: 128_000,
          input: ["text"],
        },
      ],
    );
    expect(md).toContain("**Assistant** · GPT-4o");
  });

  it("renders a reasoning part as a blockquote", () => {
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [
          { type: "reasoning", text: "let me think" },
          { type: "text", text: "answer" },
        ],
      }),
    ]);
    expect(md).toContain("> _Reasoning:_ let me think");
    expect(md).toContain("answer");
  });

  it("omits a reasoning part's opaque provider metadata from the export", () => {
    // The stored part may carry durable provider metadata (design D15); the
    // export renders its text and nothing else.
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: "let me think",
            providerMetadata: {
              openai: {
                itemId: "PRIVATE_ITEM_ID",
                reasoningEncryptedContent: "PRIVATE_ENCRYPTED_CONTENT",
              },
            },
          },
          { type: "text", text: "answer" },
        ],
      }),
    ]);

    expect(md).toContain("> _Reasoning:_ let me think");
    expect(md).toContain("answer");
    expect(md).not.toMatch(
      /PRIVATE_ITEM_ID|PRIVATE_ENCRYPTED_CONTENT|providerMetadata/,
    );
  });

  it("unglues a reasoning-summary heading persisted as one glued run", () => {
    const reasoning = {
      type: "reasoning",
      text: "**Investigating likely culprit PRs****Inspecting message schema**",
    };
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [reasoning, { type: "text", text: "answer" }],
      }),
    ]);

    expect(md).toContain(
      "> _Reasoning:_ **Investigating likely culprit PRs**\n> \n> **Inspecting message schema**",
    );
    expect(md).not.toContain("****");
    // The repair applies to the exported value only — history persisted
    // before per-part identity (or by a relay that drops the part id) keeps
    // the exact text the provider produced.
    expect(reasoning.text).toBe(
      "**Investigating likely culprit PRs****Inspecting message schema**",
    );
  });

  it("separates consecutive headed reasoning parts with a blank line", () => {
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [
          { type: "reasoning", text: "**Investigating likely culprit PRs**" },
          { type: "reasoning", text: "**Inspecting message schema**" },
        ],
      }),
    ]);

    expect(md).toContain(
      "> _Reasoning:_ **Investigating likely culprit PRs**\n> \n> **Inspecting message schema**",
    );
    expect(md).not.toContain("PRs****Inspecting");
  });

  it("leaves inline emphasis inline in the export", () => {
    const cases = [
      "the **signature** field is missing",
      "Check (**signature**) next",
      "**Heading** and then prose on the same line",
    ];

    for (const text of cases) {
      const md = chatToMarkdown("T", [
        msg({
          role: "assistant",
          parts: [{ type: "reasoning", text }],
        }),
      ]);
      expect(md).toContain(`> _Reasoning:_ ${text}`);
      // No paragraph break inside the blockquote (that would render as a
      // quoted empty line).
      expect(md).not.toContain("\n> \n");
    }
  });

  it("leaves a standalone **** separator alone in the export", () => {
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [{ type: "reasoning", text: "before\n\n****\n\nafter" }],
      }),
    ]);

    expect(md).toContain("> _Reasoning:_ before\n> \n> ****\n> \n> after");
  });

  it("skips system/tool rows and empty turns", () => {
    const md = chatToMarkdown("T", [
      msg({ role: "system", parts: [{ type: "text", text: "SYSTEM" }] }),
      msg({ role: "tool", parts: [{ type: "text", text: "TOOL" }] }),
      msg({ role: "assistant", parts: [] }), // empty
      msg({ role: "user", parts: [{ type: "text", text: "kept" }] }),
    ]);
    expect(md).not.toContain("SYSTEM");
    expect(md).not.toContain("TOOL");
    expect(md).toContain("kept");
  });

  it("separates multiple text parts (around a tool call) with a blank line", () => {
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [
          { type: "text", text: "Let me check." },
          { type: "tool-getWeather", input: {} },
          { type: "text", text: "It's sunny." },
        ],
      }),
    ]);
    expect(md).toContain("Let me check.\n\nIt's sunny.");
    expect(md).not.toContain("Let me check.It's sunny."); // no run-on
  });

  it("excludes model-switch, checkpoint, receipt, prompt, and tool-schema internals", () => {
    const md = chatToMarkdown("T", [
      msg({
        role: "user",
        parts: [
          {
            type: "data-model-context",
            data: {
              kind: "model_switch",
              fromModelId: "PRIVATE_PREVIOUS_MODEL",
              toModelId: "PRIVATE_TARGET_MODEL",
              runId: "PRIVATE_RECEIPT_REFERENCE",
            },
          },
          {
            type: "data-tool-availability",
            data: {
              version: 1,
              kind: "delta",
              runId: "PRIVATE_AVAILABILITY_RUN",
              added: [],
              removed: ["PRIVATE_REMOVED_TOOL"],
              unavailable: [
                {
                  id: "PRIVATE_UNAVAILABLE_TOOL",
                  reason: "source_disconnected",
                },
              ],
              becameUnavailable: [],
              nowAvailable: [],
              generatedReminderFixture: "PRIVATE_AVAILABILITY_REMINDER",
            },
          },
          { type: "text", text: "visible human text" },
        ],
        usage: {
          runId: "PRIVATE_RUN_ID",
          systemPrompt: "PRIVATE_SYSTEM_PROMPT",
          tools: [{ inputSchema: "PRIVATE_TOOL_SCHEMA" }],
        },
      }),
      msg({
        role: "checkpoint",
        // The owner DTO's row-level fields ride alongside the stored part.
        summary: "PRIVATE_ROW_SUMMARY",
        absorbedThroughSeq: 1,
        absorbedMessageCount: 2,
        parts: [
          {
            type: "data-context",
            data: {
              producer: "compaction",
              form: "checkpoint",
              text: '<system-reminder producer="compaction" form="checkpoint">\nPRIVATE_STORED_CHECKPOINT_TEXT\n</system-reminder>',
              payload: { v: 1, summary: "PRIVATE_RAW_CHECKPOINT_SUMMARY" },
            },
          },
        ],
      }),
    ]);

    expect(md).toContain("visible human text");
    expect(md).not.toMatch(
      /PRIVATE_|context-receipt|system-reminder|data-tool-availability/i,
    );
  });

  it("excludes prompt-imports items, so an export carries no locator, resolved path, or imported body", () => {
    const md = chatToMarkdown("T", [
      msg({
        role: "user",
        parts: [
          {
            type: "data-context",
            data: {
              v: 1,
              producer: "prompt-imports",
              form: "notice",
              runId: "44444444-4444-4444-8444-444444444444",
              payload: {
                imports: [
                  {
                    locator: "PRIVATE_LOCATOR.md",
                    resolved: "/srv/PRIVATE_RESOLVED/PRIVATE_LOCATOR.md",
                    outcome: "imported",
                  },
                ],
                omitted: ["PRIVATE_OMITTED.md"],
              },
              text: '<system-reminder producer="prompt-imports" form="notice">PRIVATE_IMPORTED_BODY</system-reminder>',
            },
          },
          { type: "text", text: "visible question" },
        ],
      }),
    ]);

    expect(md).toContain("visible question");
    expect(md).not.toMatch(/PRIVATE_|prompt-imports|system-reminder/i);
  });

  it("collapses a newline in the title so the heading stays intact", () => {
    expect(chatToMarkdown("line1\nline2", [])).toBe("# line1 line2\n");
  });

  it("an empty chat is just the title", () => {
    expect(chatToMarkdown("Empty", [])).toBe("# Empty\n");
  });
});

describe("slugifyTitle", () => {
  it("makes a filename-safe slug, fallback 'chat'", () => {
    expect(slugifyTitle("My Great Chat!")).toBe("my-great-chat");
    expect(slugifyTitle("  ")).toBe("chat");
    expect(slugifyTitle("日本語")).toBe("chat");
  });
});
