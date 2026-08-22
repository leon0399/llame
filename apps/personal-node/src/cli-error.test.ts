import { describe, expect, test } from "vitest";

import { describeCliError } from "./cli-error.js";
import { PeerSyncOutcomeUnknownError } from "./sync-client.js";

describe("personal Node CLI failures", () => {
  test("preserves the recoverable frontier when sync outcome remains unknown", () => {
    const error = new PeerSyncOutcomeUnknownError(
      3,
      { desktop: 4, phone: 2 },
      new Error("socket closed"),
    );

    expect(describeCliError(error)).toEqual({
      error: "outcome_unknown",
      operation: "peer_sync_apply",
      rounds: 3,
      localFrontier: { desktop: 4, phone: 2 },
    });
  });

  test("reports ordinary failures without inventing recovery state", () => {
    expect(describeCliError(new Error("invalid configuration"))).toEqual({
      error: "failure",
      message: "invalid configuration",
    });
  });
});
