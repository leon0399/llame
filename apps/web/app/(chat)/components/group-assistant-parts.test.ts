import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { groupAssistantParts } from "./group-assistant-parts";

const reasoning = (
  text: string,
  state?: "streaming" | "done",
): UIMessage["parts"][number] =>
  state === undefined
    ? { type: "reasoning", text }
    : { type: "reasoning", text, state };

const text = (value: string): UIMessage["parts"][number] => ({
  type: "text",
  text: value,
});

const tool = (id: string): UIMessage["parts"][number] => ({
  type: "dynamic-tool",
  toolCallId: id,
  toolName: "search_conversations",
  state: "output-available",
  input: {},
  output: {},
});

describe("groupAssistantParts", () => {
  it("merges consecutive reasoning parts into one block", () => {
    expect(
      groupAssistantParts([
        reasoning("**Investigating**"),
        reasoning("**Inspecting schema**"),
        text("done"),
      ]),
    ).toEqual([
      {
        kind: "reasoning",
        text: "**Investigating**\n\n**Inspecting schema**",
        isStreaming: false,
        startIndex: 0,
      },
      { kind: "part", part: text("done"), index: 2 },
    ]);
  });

  it("does not merge reasoning across a tool call", () => {
    const search = tool("c1");

    expect(
      groupAssistantParts([
        reasoning("think first"),
        search,
        reasoning("after tool"),
        text("answer"),
      ]),
    ).toEqual([
      {
        kind: "reasoning",
        text: "think first",
        isStreaming: false,
        startIndex: 0,
      },
      { kind: "part", part: search, index: 1 },
      {
        kind: "reasoning",
        text: "after tool",
        isStreaming: false,
        startIndex: 2,
      },
      { kind: "part", part: text("answer"), index: 3 },
    ]);
  });

  it("marks a group streaming when any member is still streaming", () => {
    expect(
      groupAssistantParts([
        reasoning("**Heading**", "done"),
        reasoning("more", "streaming"),
      ]),
    ).toEqual([
      {
        kind: "reasoning",
        text: "**Heading**\n\nmore",
        isStreaming: true,
        startIndex: 0,
      },
    ]);
  });
});
