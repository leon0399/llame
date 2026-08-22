import { describe, expect, test, vi } from "vitest";

import { PeerSyncOutcomeUnknownError } from "./sync-client.js";
import { PeerSyncSupervisor } from "./peer-sync-supervisor.js";

const synchronized = {
  rounds: 1,
  outcomeUnknownRecoveries: 0,
  pulled: 2,
  pushed: 1,
  localFrontier: { desktop: 2 },
  peerFrontier: { desktop: 2 },
  coverage: "verified-complete" as const,
};

describe("peer sync supervisor", () => {
  test("publishes sanitized semantic status after reconciliation", async () => {
    const supervisor = new PeerSyncSupervisor({
      peerId: "home",
      intervalMilliseconds: 5_000,
      sync: vi.fn().mockResolvedValue(synchronized),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
    });

    await supervisor.runOnce();

    expect(supervisor.snapshot()).toEqual({
      peerId: "home",
      state: "synchronized",
      coverage: "verified-complete",
      lastSuccessAt: "2026-08-22T12:00:00.000Z",
    });
  });

  test("distinguishes ambiguous settlement without exposing its cause", async () => {
    const cause = new Error("secret peer origin and credential");
    const supervisor = new PeerSyncSupervisor({
      peerId: "work",
      intervalMilliseconds: 5_000,
      sync: vi
        .fn()
        .mockRejectedValue(new PeerSyncOutcomeUnknownError(3, {}, cause)),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
    });

    await supervisor.runOnce();

    expect(supervisor.snapshot()).toEqual({
      peerId: "work",
      state: "degraded",
      failure: "outcome_unknown",
      lastAttemptAt: "2026-08-22T12:00:00.000Z",
    });
    expect(JSON.stringify(supervisor.snapshot())).not.toContain("secret");
  });

  test("reconciles immediately and periodically until stopped", async () => {
    vi.useFakeTimers();
    try {
      const sync = vi.fn().mockResolvedValue(synchronized);
      const supervisor = new PeerSyncSupervisor({
        peerId: "home",
        intervalMilliseconds: 5_000,
        sync,
      });

      supervisor.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(sync).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(sync).toHaveBeenCalledTimes(2);

      await supervisor.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sync).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
