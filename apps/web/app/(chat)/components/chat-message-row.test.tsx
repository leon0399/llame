/**
 * `messageBoundaries` is an exported pure derivation — call it directly and
 * inspect the returned element tree structurally, no render needed. The
 * surrounding `ChatMessageRow`/`ChatMessageFooter` components are pure
 * markup composition with zero first-party mocks, so they stay Storybook
 * territory (docs/testing.md rule 5) rather than a jsdom render test.
 */

import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { messageBoundaries } from "./chat-message-row";
import { CompactionBoundary } from "./compaction-boundary";
import type { Compaction } from "@/lib/services/chat/history";

function userMessage(parts: UIMessage["parts"] = []): UIMessage {
  return { id: "m1", role: "user", parts };
}

function assistantMessage(): UIMessage {
  return { id: "m2", role: "assistant", parts: [] };
}

const compaction: Compaction = {
  uptoSeq: 10,
  summary: "Earlier discussion summarized.",
  createdAt: "2026-01-01T00:00:00.000Z",
  stats: {
    absorbedMessageCount: 5,
    beforeTokens: 2000,
    afterTokens: 500,
    modelId: null,
  },
};

describe("messageBoundaries", () => {
  it("renders the compaction boundary only at its own index", () => {
    const at = messageBoundaries({
      message: assistantMessage(),
      index: 2,
      compaction,
      compactionIndex: 2,
      availableModels: [],
      onInspectContext: () => {},
    });
    expect(isValidElement(at.boundary)).toBe(true);
    if (!isValidElement<{ children: unknown }>(at.boundary)) return;
    // The wrapper div's only child is the real CompactionBoundary — proves
    // the right component (not a lookalike) is what gets mounted here.
    expect(isValidElement(at.boundary.props.children)).toBe(true);
    const inner = at.boundary.props.children;
    if (!isValidElement(inner)) return;
    expect(inner.type).toBe(CompactionBoundary);

    const elsewhere = messageBoundaries({
      message: assistantMessage(),
      index: 3,
      compaction,
      compactionIndex: 2,
      availableModels: [],
      onInspectContext: () => {},
    });
    expect(elsewhere.boundary).toBeNull();
  });

  it("omits the compaction boundary entirely when there is no compaction", () => {
    const result = messageBoundaries({
      message: assistantMessage(),
      index: 0,
      compaction: null,
      compactionIndex: 0,
      availableModels: [],
      onInspectContext: () => {},
    });
    expect(result.boundary).toBeNull();
  });

  it("renders a model-switch boundary only for a USER message carrying that context part", () => {
    const switchPart = {
      type: "data-context" as const,
      data: {
        v: 1 as const,
        producer: "effective-context-change" as const,
        form: "notice" as const,
        runId: "11111111-1111-1111-1111-111111111111",
        payload: {
          cause: "model" as const,
          fromModelId: "system:openai:gpt-5.4-mini",
          toModelId: "system:openai:gpt-5.4",
        },
      },
    };

    const fromUser = messageBoundaries({
      message: userMessage([switchPart]),
      index: 0,
      compaction: null,
      compactionIndex: -1,
      availableModels: [],
      onInspectContext: () => {},
    });
    expect(isValidElement(fromUser.modelBoundary)).toBe(true);

    // The same context part on an ASSISTANT message is not a switch
    // boundary trigger — modelSwitchPart only inspects user turns.
    const assistantWithPart: UIMessage = {
      id: "m3",
      role: "assistant",
      parts: [switchPart],
    };
    const fromAssistant = messageBoundaries({
      message: assistantWithPart,
      index: 0,
      compaction: null,
      compactionIndex: -1,
      availableModels: [],
      onInspectContext: () => {},
    });
    expect(fromAssistant.modelBoundary).toBeNull();
  });

  it("omits the model-switch boundary for a plain user message with no context part", () => {
    const result = messageBoundaries({
      message: userMessage([{ type: "text", text: "hi" }]),
      index: 0,
      compaction: null,
      compactionIndex: -1,
      availableModels: [],
      onInspectContext: () => {},
    });
    expect(result.modelBoundary).toBeNull();
  });
});
