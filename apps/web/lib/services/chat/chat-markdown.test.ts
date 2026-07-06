import { describe, expect, it } from "vitest";

import { chatToMarkdown, slugifyTitle } from "./chat-markdown";

// Minimal ChatMessageResponse-shaped fixtures (only the fields the renderer reads).
const msg = (over: Record<string, unknown>) =>
  ({
    id: "m",
    chatId: "c",
    seq: 1,
    senderUserId: null,
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: "2026-07-03T00:00:00Z",
    ...over,
  }) as never;

describe("chatToMarkdown", () => {
  it("renders user + assistant turns with headings and text", () => {
    const md = chatToMarkdown("My Chat", [
      msg({ role: "user", parts: [{ type: "text", text: "hi" }] }),
      msg({
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
        usage: { model: "openai:gpt-4o" },
      }),
    ]);
    expect(md).toContain("# My Chat");
    expect(md).toContain("**You**\n\nhi");
    expect(md).toContain("**Assistant** · GPT-4o\n\nhello");
    expect(md).toContain("\n---\n"); // separator between turns
  });

  it("falls back to the provider-stripped tail for an unrecognized model id", () => {
    // Now shares lib/ai/models.ts's modelDisplayName with the chat UI (a prior
    // review round found this file kept its own local, non-dual-keyed
    // duplicate) — its fallback strips the provider prefix rather than
    // showing the raw id verbatim, matching what the footer shows.
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [{ type: "text", text: "hi" }],
        usage: { model: "custom:unknown-model" },
      }),
    ]);
    expect(md).toContain("**Assistant** · unknown-model");
  });

  it("resolves a BARE catalog model id too (live/persisted ids are unprefixed)", () => {
    const md = chatToMarkdown("T", [
      msg({
        role: "assistant",
        parts: [{ type: "text", text: "hi" }],
        usage: { model: "gpt-4o" },
      }),
    ]);
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
