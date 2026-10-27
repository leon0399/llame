/**
 * The latest turn's action rules (turn-actions D13). Pure derivations — no
 * render needed; the row and the transcript only paint what they say.
 */

import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";

import {
  carriesTurnActions,
  discardedCallNames,
  hiddenFollowUpReplyIndex,
  needsFailedTurnRow,
  supersededReplyIndexes,
  turnActionVisibility,
  type TurnReply,
} from "./turn-action-rules";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const NEXT_RUN_ID = "22222222-2222-4222-8222-222222222222";

function latestRun(
  overrides: Partial<ChatLatestRunResponse> = {},
): ChatLatestRunResponse {
  return {
    id: RUN_ID,
    messageId: "user-1",
    status: "failed",
    followUpAction: null,
    modelId: "system:openai:gpt-5.4-mini",
    effort: "low",
    permissionMode: "default",
    ...overrides,
  };
}

const SETTLED_TOOL: UIMessage["parts"][number] = {
  type: "tool-search_conversations",
  toolCallId: "call-1",
  state: "output-available",
  input: { query: "budget" },
  output: { status: "success" },
};

const ANSWER: UIMessage["parts"][number] = { type: "text", text: "Answer." };

function reply(overrides: Partial<TurnReply> = {}): TurnReply {
  return {
    metadata: { seq: 2, usage: { runId: RUN_ID, status: "error" } },
    parts: [SETTLED_TOOL, ANSWER],
    ...overrides,
  };
}

function assistantMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [ANSWER],
    metadata: { seq: 2, usage: { runId: RUN_ID, status: "error" } },
    ...overrides,
  };
}

function userMessage(
  id: string,
  overrides: Partial<UIMessage> = {},
): UIMessage {
  return { id, role: "user", parts: [ANSWER], ...overrides };
}

describe("turnActionVisibility", () => {
  it("offers both actions on a failed turn that settled a tool call", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun(),
        reply: reply(),
        status: "ready",
      }),
    ).toEqual({ continueTurn: true });
  });

  it("offers Continue on a cancelled and on an expired Run", () => {
    for (const status of ["cancelled", "expired"] as const) {
      expect(
        turnActionVisibility({
          latestRun: latestRun({ status }),
          reply: reply(),
          status: "ready",
        }),
      ).toEqual({ continueTurn: true });
    }
  });

  it("hides Continue when no tool call settled", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun(),
        reply: reply({ parts: [ANSWER] }),
        status: "ready",
      }),
    ).toEqual({ continueTurn: false });
  });

  it("hides Continue when the reply's usage completed", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun({ status: "completed" }),
        reply: reply({
          metadata: { seq: 2, usage: { runId: RUN_ID, status: "completed" } },
        }),
        status: "ready",
      }),
    ).toEqual({ continueTurn: false });
  });

  it("hides Continue when another Run produced the reply", () => {
    const visibility = turnActionVisibility({
      latestRun: latestRun(),
      reply: reply({
        metadata: { seq: 2, usage: { runId: NEXT_RUN_ID, status: "error" } },
      }),
      status: "ready",
    });
    expect(visibility).toEqual({ continueTurn: false });
  });

  it("offers Regenerate alone on a terminal turn with no reply", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun(),
        reply: null,
        status: "ready",
      }),
    ).toEqual({ continueTurn: false });
  });

  it("offers nothing while a request is in flight", () => {
    for (const status of ["submitted", "streaming"] as const) {
      expect(
        turnActionVisibility({
          latestRun: latestRun(),
          reply: reply(),
          status,
        }),
      ).toBeNull();
    }
  });

  it("offers nothing while the latest Run still executes", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun({ status: "running_model" }),
        reply: reply(),
        status: "ready",
      }),
    ).toBeNull();
  });

  it("offers nothing when the Chat has no Run", () => {
    expect(
      turnActionVisibility({
        latestRun: null,
        reply: reply(),
        status: "ready",
      }),
    ).toBeNull();
  });
});

describe("carriesTurnActions", () => {
  it("puts the actions on the reply of the Run's own turn", () => {
    expect(
      carriesTurnActions({
        messages: [userMessage("user-1"), assistantMessage()],
        latestRun: latestRun({ status: "completed" }),
        status: "ready",
      }),
    ).toBe(true);
  });

  it("keeps them off an older turn's reply", () => {
    expect(
      carriesTurnActions({
        messages: [
          userMessage("user-1"),
          assistantMessage(),
          userMessage("user-2"),
          assistantMessage({ id: "assistant-2" }),
        ],
        latestRun: latestRun({ messageId: "user-2", status: "completed" }),
        status: "ready",
      }),
    ).toBe(true);
    // The same window, but the Run names no turn in it: a `#msg-N` view of an
    // older turn ends on an older reply.
    expect(
      carriesTurnActions({
        messages: [userMessage("user-1"), assistantMessage()],
        latestRun: latestRun({ messageId: "user-9", status: "completed" }),
        status: "ready",
      }),
    ).toBe(false);
  });

  it("keeps them off a turn that left no reply", () => {
    expect(
      carriesTurnActions({
        messages: [userMessage("user-1")],
        latestRun: latestRun({ status: "completed" }),
        status: "ready",
      }),
    ).toBe(false);
  });

  it("keeps them off while a request is in flight", () => {
    expect(
      carriesTurnActions({
        messages: [userMessage("user-1"), assistantMessage()],
        latestRun: latestRun({ status: "completed" }),
        status: "streaming",
      }),
    ).toBe(false);
  });
});

describe("discardedCallNames", () => {
  /** A stored tool part: the api writes `tool-<name>` with a settled state and,
   *  beside it, the classification of the tool that ran. The classification
   *  rides a spread because it is the api's own extra field, not a part the AI
   *  SDK's union declares. */
  function toolPart(input: {
    name: string;
    state: "output-available" | "output-error";
    classification?: string | null;
  }): UIMessage["parts"][number] {
    const settled: UIMessage["parts"][number] =
      input.state === "output-available"
        ? {
            type: `tool-${input.name}`,
            toolCallId: `call-${input.name}`,
            state: "output-available",
            input: {},
            output: {},
          }
        : {
            type: `tool-${input.name}`,
            toolCallId: `call-${input.name}`,
            state: "output-error",
            input: {},
            errorText: "The call failed.",
          };
    return {
      ...settled,
      ...(input.classification !== undefined && {
        classification: input.classification,
      }),
    };
  }

  it("names each call whose effects stay, once", () => {
    const names = discardedCallNames([
      toolPart({
        name: "edit",
        state: "output-available",
        classification: "write_low_risk",
      }),
      toolPart({
        name: "bash",
        state: "output-available",
        classification: "execute_code",
      }),
      toolPart({
        name: "edit",
        state: "output-error",
        classification: "write_low_risk",
      }),
    ]);
    expect(names).toEqual(["edit", "bash"]);
  });

  it("counts a legacy part with no classification", () => {
    expect(
      discardedCallNames([
        toolPart({ name: "edit", state: "output-available" }),
      ]),
    ).toEqual(["edit"]);
  });

  it("disregards a read-only call and a call that never started", () => {
    expect(
      discardedCallNames([
        toolPart({
          name: "read",
          state: "output-available",
          classification: "read_only",
        }),
        toolPart({ name: "bash", state: "output-error", classification: null }),
      ]),
    ).toEqual([]);
  });

  it("disregards a call that has not settled", () => {
    expect(
      discardedCallNames([
        {
          type: "dynamic-tool",
          toolCallId: "call-running",
          toolName: "edit",
          state: "input-available",
          input: {},
        },
      ]),
    ).toEqual([]);
  });
});

describe("hiddenFollowUpReplyIndex", () => {
  it("hides the reply of the turn a queued follow-up Run replaces", () => {
    expect(
      hiddenFollowUpReplyIndex(
        [userMessage("user-1"), assistantMessage()],
        latestRun({
          id: NEXT_RUN_ID,
          status: "queued",
          followUpAction: "regenerate",
        }),
      ),
    ).toBe(1);
  });

  it("hides it once the resumed stream has attached after it", () => {
    // The SDK pushes the resumed stream as a new message (its id is the Run's)
    // rather than replacing the durable reply.
    expect(
      hiddenFollowUpReplyIndex(
        [
          userMessage("user-1"),
          assistantMessage(),
          { id: NEXT_RUN_ID, role: "assistant", parts: [] },
        ],
        latestRun({
          id: NEXT_RUN_ID,
          status: "running_model",
          followUpAction: "continue",
        }),
      ),
    ).toBe(1);
  });

  it("keeps the reply once the follow-up Run settled", () => {
    expect(
      hiddenFollowUpReplyIndex(
        [userMessage("user-1"), assistantMessage()],
        latestRun({ status: "failed", followUpAction: "continue" }),
      ),
    ).toBeNull();
  });

  it("keeps a reply the follow-up Run itself wrote", () => {
    expect(
      hiddenFollowUpReplyIndex(
        [
          userMessage("user-1"),
          assistantMessage({
            metadata: {
              seq: 2,
              usage: { runId: NEXT_RUN_ID, status: "running" },
            },
          }),
        ],
        latestRun({
          id: NEXT_RUN_ID,
          status: "running_model",
          followUpAction: "regenerate",
        }),
      ),
    ).toBeNull();
  });

  it("keeps a live placeholder, which holds no durable seq", () => {
    expect(
      hiddenFollowUpReplyIndex(
        [userMessage("user-1"), { id: RUN_ID, role: "assistant", parts: [] }],
        latestRun({ status: "queued", followUpAction: "continue" }),
      ),
    ).toBeNull();
  });

  it("hides nothing for a chat send, a settled Run, or another turn", () => {
    const messages = [userMessage("user-1"), assistantMessage()];
    expect(
      hiddenFollowUpReplyIndex(
        messages,
        latestRun({ status: "running_model" }),
      ),
    ).toBeNull();
    expect(hiddenFollowUpReplyIndex(messages, null)).toBeNull();
    // A `#msg-N` view of an older turn must not hide its target row.
    expect(
      hiddenFollowUpReplyIndex(
        messages,
        latestRun({
          messageId: "user-9",
          status: "queued",
          followUpAction: "regenerate",
        }),
      ),
    ).toBeNull();
  });
});

describe("needsFailedTurnRow", () => {
  it("asks for the row when the latest turn left no reply", () => {
    expect(
      needsFailedTurnRow({
        messages: [userMessage("user-1")],
        latestRun: latestRun(),
        status: "ready",
      }),
    ).toBe(true);
  });

  it("asks for it beside the empty placeholder a pickup failure leaves", () => {
    expect(
      needsFailedTurnRow({
        messages: [
          userMessage("user-1"),
          { id: RUN_ID, role: "assistant", parts: [] },
        ],
        latestRun: latestRun(),
        status: "ready",
      }),
    ).toBe(true);
  });

  it("keeps the row away from a turn that has a reply", () => {
    expect(
      needsFailedTurnRow({
        messages: [userMessage("user-1"), assistantMessage()],
        latestRun: latestRun(),
        status: "ready",
      }),
    ).toBe(false);
  });

  it("keeps the row away from a Run the window does not name", () => {
    expect(
      needsFailedTurnRow({
        messages: [userMessage("user-2")],
        latestRun: latestRun(),
        status: "ready",
      }),
    ).toBe(false);
  });

  it("keeps the row away while a request is in flight", () => {
    for (const status of ["submitted", "streaming"] as const) {
      expect(
        needsFailedTurnRow({
          messages: [userMessage("user-1")],
          latestRun: latestRun({ status: "queued" }),
          status,
        }),
      ).toBe(false);
    }
  });
});

describe("supersededReplyIndexes", () => {
  it("hides the durable reply a live stream replaces, wherever it sits", () => {
    expect([
      ...supersededReplyIndexes([
        userMessage("user-1"),
        assistantMessage(),
        { id: NEXT_RUN_ID, role: "assistant", parts: [] },
      ]),
    ]).toEqual([1]);
  });

  it("hides nothing when the live reply has no durable copy beside it", () => {
    expect(
      supersededReplyIndexes([
        userMessage("user-1"),
        { id: NEXT_RUN_ID, role: "assistant", parts: [] },
      ]).size,
    ).toBe(0);
  });

  it("hides nothing once the stream's own reply is the durable one", () => {
    expect(
      supersededReplyIndexes([
        userMessage("user-1"),
        assistantMessage({
          metadata: {
            seq: 2,
            usage: { runId: NEXT_RUN_ID, status: "running" },
          },
        }),
      ]).size,
    ).toBe(0);
  });

  it("hides a superseded reply per turn", () => {
    expect([
      ...supersededReplyIndexes([
        userMessage("user-1"),
        assistantMessage({ id: "assistant-1" }),
        userMessage("user-2"),
        assistantMessage({ id: "assistant-2" }),
        { id: NEXT_RUN_ID, role: "assistant", parts: [] },
      ]),
    ]).toEqual([3]);
  });
});
