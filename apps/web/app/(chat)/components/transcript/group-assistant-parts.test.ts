import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { groupAssistantParts, groupReplyBlocks } from "./group-assistant-parts";

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

  it("does not merge reasoning across a visible text part", () => {
    expect(
      groupAssistantParts([
        reasoning("before the answer"),
        text("the answer"),
        reasoning("after the answer"),
      ]),
    ).toEqual([
      {
        kind: "reasoning",
        text: "before the answer",
        isStreaming: false,
        startIndex: 0,
      },
      { kind: "part", part: text("the answer"), index: 1 },
      {
        kind: "reasoning",
        text: "after the answer",
        isStreaming: false,
        startIndex: 2,
      },
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

  it("keeps a single reasoning part's own streaming state", () => {
    expect(
      groupAssistantParts([reasoning("still thinking", "streaming")]),
    ).toEqual([
      {
        kind: "reasoning",
        text: "still thinking",
        isStreaming: true,
        startIndex: 0,
      },
    ]);
  });

  it("renders only a reasoning part's text, never its opaque provider metadata", () => {
    // The Thinking panel is fed `segment.text` alone, so a stored part
    // carrying durable provider metadata (design D15) must group down to its
    // text: no key and no opaque value may survive into the render input.
    const withMetadata: UIMessage["parts"][number] = {
      type: "reasoning",
      text: "the plan",
      providerMetadata: {
        openai: {
          itemId: "PRIVATE_ITEM_ID",
          reasoningEncryptedContent: "PRIVATE_ENCRYPTED_CONTENT",
        },
      },
    };

    const grouped = groupAssistantParts([withMetadata, text("done")]);

    expect(grouped).toEqual([
      {
        kind: "reasoning",
        text: "the plan",
        isStreaming: false,
        startIndex: 0,
      },
      { kind: "part", part: text("done"), index: 1 },
    ]);
    expect(JSON.stringify(grouped)).not.toMatch(
      /PRIVATE_ITEM_ID|PRIVATE_ENCRYPTED_CONTENT|providerMetadata/,
    );
  });

  it("leaves the message's parts untouched", () => {
    const parts = [
      reasoning("**One****Two**"),
      tool("c1"),
      reasoning("after the tool"),
      text("answer"),
    ];

    const before = structuredClone(parts);

    groupAssistantParts(parts);

    expect(parts).toEqual(before);
  });
});

/** The kind of each block, with a steps block's step count. */
function replyOutline(parts: UIMessage["parts"]): Array<string> {
  return groupReplyBlocks(groupAssistantParts(parts)).map((block) =>
    block.kind === "steps" ? `steps:${block.steps.length}` : block.kind,
  );
}

describe("groupReplyBlocks", () => {
  it("folds a run of thinking and tool calls into one block of steps", () => {
    expect(
      replyOutline([reasoning("plan"), tool("c1"), tool("c2"), text("answer")]),
    ).toEqual(["steps:3", "part"]);
  });

  it("starts a new run of steps after each piece of the answer", () => {
    expect(
      replyOutline([
        tool("c1"),
        text("first"),
        reasoning("check"),
        tool("c2"),
        text("second"),
      ]),
    ).toEqual(["steps:1", "part", "steps:2", "part"]);
  });

  it("keeps the steps of a run in their stored order", () => {
    const [block] = groupReplyBlocks(
      groupAssistantParts([tool("c1"), reasoning("between"), tool("c2")]),
    );

    expect(
      block?.kind === "steps" ? block.steps.map((s) => s.kind) : [],
    ).toEqual(["tool", "reasoning", "tool"]);
  });
});
