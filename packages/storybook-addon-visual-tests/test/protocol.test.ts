import { describe, expect, test } from "vitest";

import { parseCommand } from "../src/shared/protocol.js";

describe("parseCommand", () => {
  test("accepts run commands and exact approvals", () => {
    expect(parseCommand({ type: "run", scope: "all" })).toEqual({
      type: "run",
      scope: "all",
    });
    expect(
      parseCommand({
        type: "approve",
        runId: "run-1",
        storyId: "button--primary",
        environmentKey: "chromium-1280x720@1x",
        candidateSha256: "a".repeat(64),
      }),
    ).toMatchObject({ type: "approve", runId: "run-1" });
    expect(
      parseCommand({ type: "load-baseline", storyId: "button--primary" }),
    ).toEqual({ type: "load-baseline", storyId: "button--primary" });
  });

  test("rejects malformed and path-bearing commands", () => {
    expect(parseCommand({ type: "run", scope: "current" })).toBeUndefined();
    expect(
      parseCommand({ type: "get-state", path: "/tmp/baseline.png" }),
    ).toBeUndefined();
    expect(
      parseCommand({
        type: "approve",
        runId: "run-1",
        storyId: "button--primary",
        environmentKey: "chromium-1280x720@1x",
        candidateSha256: "bad",
      }),
    ).toBeUndefined();
    expect(parseCommand({ type: "load-baseline" })).toBeUndefined();
    expect(
      parseCommand({
        type: "load-baseline",
        storyId: "button--primary",
        extra: 1,
      }),
    ).toBeUndefined();
  });
});
