import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";

import {
  discardedCallNames,
  isTerminalRunStatus,
  needsFailedTurnRow,
  replacedReplyIndex,
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

describe("isTerminalRunStatus", () => {
  it("accepts every status a Run cannot leave on its own", () => {
    for (const status of ["completed", "failed", "cancelled", "expired"]) {
      expect(isTerminalRunStatus(status)).toBe(true);
    }
  });

  it("rejects the statuses of a Run that still executes", () => {
    for (const status of ["queued", "running_model", "running_tool"]) {
      expect(isTerminalRunStatus(status)).toBe(false);
    }
  });
});

describe("turnActionVisibility", () => {
  it("offers both actions on a failed turn that settled a tool call", () => {
    expect(
      turnActionVisibility({ latestRun: latestRun(), reply: reply() }),
    ).toEqual({ continueTurn: true, regenerate: true });
  });

  it("offers Continue on a cancelled and on an expired Run", () => {
    for (const status of ["cancelled", "expired"] as const) {
      expect(
        turnActionVisibility({
          latestRun: latestRun({ status }),
          reply: reply(),
        }).continueTurn,
      ).toBe(true);
    }
  });

  it("hides Continue when no tool call settled", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun(),
        reply: reply({ parts: [ANSWER] }),
      }),
    ).toEqual({ continueTurn: false, regenerate: true });
  });

  it("hides Continue when the reply's usage completed", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun({ status: "completed" }),
        reply: reply({
          metadata: { seq: 2, usage: { runId: RUN_ID, status: "completed" } },
        }),
      }),
    ).toEqual({ continueTurn: false, regenerate: true });
  });

  it("hides Continue when another Run produced the reply", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun(),
        reply: reply({
          metadata: { seq: 2, usage: { runId: NEXT_RUN_ID, status: "error" } },
        }),
      }).continueTurn,
    ).toBe(false);
  });

  it("hides both actions while the latest Run is still executing", () => {
    expect(
      turnActionVisibility({
        latestRun: latestRun({ status: "running_model" }),
        reply: reply(),
      }),
    ).toEqual({ continueTurn: false, regenerate: false });
  });

  it("offers Regenerate alone on a terminal turn with no reply", () => {
    expect(
      turnActionVisibility({ latestRun: latestRun(), reply: null }),
    ).toEqual({ continueTurn: false, regenerate: true });
  });

  it("hides both actions when the Chat has no Run", () => {
    expect(turnActionVisibility({ latestRun: null, reply: reply() })).toEqual({
      continueTurn: false,
      regenerate: false,
    });
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

describe("replacedReplyIndex", () => {
  it("hides the reply a queued follow-up Run has not replaced yet", () => {
    const messages = [
      { id: "user-1", role: "user" as const, parts: [] },
      assistantMessage(),
    ];
    expect(
      replacedReplyIndex(
        messages,
        latestRun({
          id: NEXT_RUN_ID,
          status: "queued",
          followUpAction: "regenerate",
        }),
      ),
    ).toBe(1);
  });

  it("keeps the reply once the follow-up Run settled", () => {
    const messages = [
      { id: "user-1", role: "user" as const, parts: [] },
      assistantMessage(),
    ];
    expect(
      replacedReplyIndex(
        messages,
        latestRun({ status: "failed", followUpAction: "continue" }),
      ),
    ).toBeNull();
  });

  it("keeps a reply the follow-up Run itself wrote", () => {
    const messages = [
      { id: "user-1", role: "user" as const, parts: [] },
      assistantMessage({
        metadata: { seq: 2, usage: { runId: NEXT_RUN_ID, status: "running" } },
      }),
    ];
    expect(
      replacedReplyIndex(
        messages,
        latestRun({
          id: NEXT_RUN_ID,
          status: "running_model",
          followUpAction: "regenerate",
        }),
      ),
    ).toBeNull();
  });

  it("keeps a live placeholder, which holds no durable seq", () => {
    const messages = [
      { id: "user-1", role: "user" as const, parts: [] },
      { id: RUN_ID, role: "assistant" as const, parts: [] },
    ];
    expect(
      replacedReplyIndex(
        messages,
        latestRun({ status: "queued", followUpAction: "continue" }),
      ),
    ).toBeNull();
  });

  it("hides nothing for a chat send or a chat with no Run", () => {
    const messages = [
      { id: "user-1", role: "user" as const, parts: [] },
      assistantMessage(),
    ];
    expect(
      replacedReplyIndex(messages, latestRun({ status: "running_model" })),
    ).toBeNull();
    expect(replacedReplyIndex(messages, null)).toBeNull();
  });
});

describe("needsFailedTurnRow", () => {
  it("asks for the row when the latest turn left no reply", () => {
    expect(
      needsFailedTurnRow(
        [{ id: "user-1", role: "user", parts: [] }],
        latestRun(),
      ),
    ).toBe(true);
  });

  it("keeps the row away from a turn that has a reply", () => {
    expect(
      needsFailedTurnRow(
        [{ id: "user-1", role: "user", parts: [] }, assistantMessage()],
        latestRun(),
      ),
    ).toBe(false);
  });

  it("keeps the row away from a Run the latest turn does not own", () => {
    expect(
      needsFailedTurnRow(
        [{ id: "user-2", role: "user", parts: [] }],
        latestRun(),
      ),
    ).toBe(false);
  });

  it("keeps the row away while the Run is still executing", () => {
    expect(
      needsFailedTurnRow(
        [{ id: "user-1", role: "user", parts: [] }],
        latestRun({ status: "queued" }),
      ),
    ).toBe(false);
  });
});
