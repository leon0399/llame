/**
 * `messageBoundaries`, `hasVisibleContent`, and `messageRowMode` are exported
 * pure derivations — call them directly, no render needed (for
 * `messageBoundaries`, inspect the returned element tree structurally). The
 * surrounding `ChatMessageRow`/`ChatMessageFooter` components are pure
 * markup composition with zero first-party mocks, so they stay Storybook
 * territory (docs/testing.md rule 5) rather than a jsdom render test.
 */

import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  hasVisibleContent,
  messageBoundaries,
  messageRowMode,
} from "./chat-message-row";
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

const TOOL_PART: UIMessage["parts"][number] = {
  type: "dynamic-tool",
  toolCallId: "call-1",
  toolName: "search_conversations",
  state: "input-streaming",
  input: undefined,
};

const CAP_NOTICE_PART: UIMessage["parts"][number] = {
  type: "data-cap-notice",
  data: { stepsUsed: 8, maxSteps: 8 },
};

const CONTEXT_PART: UIMessage["parts"][number] = {
  type: "data-context",
  data: {
    v: 1,
    producer: "effective-context-change",
    form: "notice",
    runId: "11111111-1111-1111-1111-111111111111",
    payload: {
      cause: "model",
      fromModelId: "system:openai:gpt-5.4-mini",
      toModelId: "system:openai:gpt-5.4",
    },
  },
};

describe("hasVisibleContent", () => {
  it("counts text, tool, and notice parts as visible content", () => {
    expect(hasVisibleContent([{ type: "text", text: "Answer." }])).toBe(true);
    expect(hasVisibleContent([TOOL_PART])).toBe(true);
    expect(hasVisibleContent([CAP_NOTICE_PART])).toBe(true);
  });

  it("finds nothing visible in a reasoning run that carries no text", () => {
    // A withheld thinking block keeps its signature and a live delta can
    // still arrive as whitespace; neither paints a Thinking panel, so
    // neither is content the row can show.
    expect(
      hasVisibleContent([
        {
          type: "reasoning",
          text: "",
          state: "done",
          providerMetadata: { anthropic: { signature: "opaque" } },
        },
        { type: "reasoning", text: "\n  \n", state: "done" },
      ]),
    ).toBe(false);
  });

  it("counts a reasoning run that carries text, even beside a blank one", () => {
    expect(
      hasVisibleContent([
        { type: "reasoning", text: "   ", state: "done" },
        { type: "text", text: "Answer." },
        { type: "reasoning", text: "**Thought**", state: "streaming" },
      ]),
    ).toBe(true);
  });

  it("finds nothing visible in server-authored context parts or in no parts", () => {
    expect(hasVisibleContent([CONTEXT_PART])).toBe(false);
    expect(hasVisibleContent([])).toBe(false);
  });
});

describe("messageRowMode", () => {
  /** The placeholder the stream's `start` frame creates: its id is the Run's,
   *  and it carries no seq until the turn persists. */
  const livePlaceholder = (): UIMessage => ({
    id: "11111111-1111-1111-1111-111111111111",
    role: "assistant",
    parts: [],
  });

  const persistedEmptyTurn = (metadata: {
    seq: number;
    usage?: { status: string };
  }): UIMessage => ({
    id: "22222222-2222-2222-2222-222222222222",
    role: "assistant",
    parts: [],
    metadata,
  });

  it("shows the pending indicator on the last assistant row while the chat is in flight", () => {
    // The row the `start` frame created before any output, in both in-flight
    // statuses. A pending stop (M3's S4) changes the composer's control, not
    // the chat status, so the indicator stays up until the chat settles.
    for (const status of ["submitted", "streaming"] as const) {
      expect(
        messageRowMode({ message: livePlaceholder(), isLast: true, status }),
      ).toBe("pending");
    }
  });

  it("renders a user turn with no visible content as content", () => {
    // The rule is about assistant placeholders; a user turn is never withheld.
    expect(
      messageRowMode({
        message: userMessage([CONTEXT_PART]),
        isLast: true,
        status: "submitted",
      }),
    ).toBe("content");
  });

  it("keeps a streaming turn that has output out of the indicator", () => {
    expect(
      messageRowMode({
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Partial" }],
        },
        isLast: true,
        status: "streaming",
      }),
    ).toBe("content");
  });

  it("hides the live placeholder once a Stop before any output settles the chat", () => {
    // The Run was cancelled before its model request: it persists no
    // assistant message, so the placeholder — whose id is a Run id — paints
    // nothing rather than an empty bubble with a fork action.
    for (const status of ["ready", "error"] as const) {
      expect(
        messageRowMode({ message: livePlaceholder(), isLast: true, status }),
      ).toBe("hidden");
    }
  });

  it("renders the persisted empty turn history adoption brings in", () => {
    // Cancelled during its model request: the turn has no parts but a
    // durable seq, so it renders as today and shows its "stopped" usage.
    expect(
      messageRowMode({
        message: persistedEmptyTurn({ seq: 12, usage: { status: "aborted" } }),
        isLast: true,
        status: "ready",
      }),
    ).toBe("content");
  });

  it("hides a live placeholder that a following send moved behind newer turns", () => {
    // Adoption keeps the trailing live-only row the refetched history does
    // not carry; the next send puts newer turns after it, and the row in
    // flight is the new last one.
    const stopped = livePlaceholder();
    const pending = livePlaceholder();
    expect(
      messageRowMode({ message: stopped, isLast: false, status: "submitted" }),
    ).toBe("hidden");
    expect(
      messageRowMode({ message: pending, isLast: true, status: "submitted" }),
    ).toBe("pending");
  });

  it("keeps a persisted empty turn visible behind newer turns", () => {
    expect(
      messageRowMode({
        message: persistedEmptyTurn({ seq: 12 }),
        isLast: false,
        status: "streaming",
      }),
    ).toBe("content");
  });
});
