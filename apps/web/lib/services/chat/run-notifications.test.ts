import { describe, expect, it } from "vitest";

import {
  isTerminalRunStatus,
  resolveTerminalRun,
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
