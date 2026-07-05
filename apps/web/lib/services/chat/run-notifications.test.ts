import { describe, expect, it } from "vitest";

import {
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
    expect(resolveTerminalRun("cancelled", away)).toEqual({
      toast: null,
      badge: false,
    });
    expect(resolveTerminalRun("cancelled", viewing).toast).toBeNull();
  });

  it("completed while away → reply-ready toast + badge", () => {
    expect(resolveTerminalRun("completed", away)).toEqual({
      toast: "completed",
      badge: true,
    });
  });

  it("completed while viewing + visible → silent (they saw it)", () => {
    expect(resolveTerminalRun("completed", viewing)).toEqual({
      toast: null,
      badge: false,
    });
  });

  it("completed while viewing but tab hidden → notify (they backgrounded it)", () => {
    expect(
      resolveTerminalRun("completed", {
        viewingThisChat: true,
        tabHidden: true,
      }).toast,
    ).toBe("completed");
  });

  it("failed and expired both surface a failure toast when away", () => {
    expect(resolveTerminalRun("failed", away).toast).toBe("failed");
    // expired = reaped/hung — the reply never came, so it's NOT swallowed.
    expect(resolveTerminalRun("expired", away).toast).toBe("failed");
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
  it("truncates the first user turn's text", () => {
    expect(
      notificationLabel([
        {
          role: "user",
          parts: [{ type: "text", text: "a".repeat(60) }],
        },
      ]),
    ).toBe("a".repeat(48));
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
