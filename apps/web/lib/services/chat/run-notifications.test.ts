import { describe, expect, it } from "vitest";

import {
  isInterruptedStream,
  isTerminalRunStatus,
  notificationLabel,
  resolveTerminalRun,
  streamingRunId,
} from "./run-notifications";

describe("isTerminalRunStatus", () => {
  it("is true for terminal statuses only", () => {
    for (const s of ["completed", "failed", "cancelled", "expired"]) {
      expect(isTerminalRunStatus(s)).toBe(true);
    }
    for (const s of ["queued", "running_model", "running_tool"]) {
      expect(isTerminalRunStatus(s)).toBe(false);
    }
  });
});

describe("resolveTerminalRun", () => {
  const away = { viewingThisChat: false, tabHidden: false };
  const viewing = { viewingThisChat: true, tabHidden: false };

  it("cancelled is always silent (user stop / superseded)", () => {
    expect(resolveTerminalRun("cancelled", away)).toBeNull();
    expect(resolveTerminalRun("cancelled", viewing)).toBeNull();
  });

  it("completed while away → reply-ready toast + badge", () => {
    expect(resolveTerminalRun("completed", away)).toBe("completed");
  });

  it("completed while viewing + visible → silent (they saw it)", () => {
    expect(resolveTerminalRun("completed", viewing)).toBeNull();
  });

  it("completed while viewing but tab hidden → notify (they backgrounded it)", () => {
    expect(
      resolveTerminalRun("completed", {
        viewingThisChat: true,
        tabHidden: true,
      }),
    ).toBe("completed");
  });

  it("failed and expired both surface a failure toast when away", () => {
    expect(resolveTerminalRun("failed", away)).toBe("failed");
    // expired = reaped/hung — the reply never came, so it's NOT swallowed.
    expect(resolveTerminalRun("expired", away)).toBe("failed");
  });
});

describe("streamingRunId", () => {
  it("returns the last message id when it is the streaming assistant turn", () => {
    expect(
      streamingRunId([
        { id: "u1", role: "user" },
        { id: "run-42", role: "assistant" },
      ]),
    ).toBe("run-42");
  });

  it("returns null in the submitted window (last message is the user turn)", () => {
    expect(
      streamingRunId([
        { id: "a-prev", role: "assistant" },
        { id: "u2", role: "user" },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty message list", () => {
    expect(streamingRunId([])).toBeNull();
  });
});

describe("notificationLabel", () => {
  it("truncates the first user turn's text with an ellipsis", () => {
    expect(
      notificationLabel([
        {
          role: "user",
          parts: [{ type: "text", text: "a".repeat(60) }],
        },
      ]),
    ).toBe("a".repeat(48) + "...");
  });

  it("does not append an ellipsis when the text fits within the limit", () => {
    expect(
      notificationLabel([
        { role: "user", parts: [{ type: "text", text: "short question" }] },
      ]),
    ).toBe("short question");
  });

  it("falls back to a generic label when the first user turn has no text", () => {
    expect(
      notificationLabel([{ role: "user", parts: [{ type: "step-start" }] }]),
    ).toBe("your conversation");
  });

  it("falls back to a generic label when there is no user turn yet", () => {
    expect(notificationLabel([])).toBe("your conversation");
  });
});

describe("isInterruptedStream", () => {
  const completion: Parameters<typeof isInterruptedStream>[0] = {
    isAbort: false,
    isDisconnect: false,
    isError: false,
    finishReason: "stop",
  };

  it("treats a stream that carried the run's terminal chunk as finished", () => {
    expect(isInterruptedStream(completion)).toBe(false);
  });

  it("treats a stream that ended without a terminal chunk as interrupted", () => {
    expect(
      isInterruptedStream({ ...completion, finishReason: undefined }),
    ).toBe(true);
  });

  it("treats the user's own stop as an end, not an interruption to repair", () => {
    expect(
      isInterruptedStream({
        ...completion,
        isAbort: true,
        finishReason: undefined,
      }),
    ).toBe(false);
  });

  it("treats a failed run as an end — its error chunk is terminal too", () => {
    expect(
      isInterruptedStream({
        ...completion,
        isError: true,
        finishReason: undefined,
      }),
    ).toBe(false);
  });

  it("treats a dropped connection as an interruption, not a failed run", () => {
    expect(
      isInterruptedStream({
        ...completion,
        isDisconnect: true,
        isError: true,
        finishReason: undefined,
      }),
    ).toBe(true);
  });
});
