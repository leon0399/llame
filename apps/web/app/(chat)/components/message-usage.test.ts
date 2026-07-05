import { describe, expect, it } from "vitest";

import { parseTurnUsage, usageStatusLabel } from "./message-usage";

describe("usageStatusLabel", () => {
  it("labels non-completed turns and leaves completed unlabeled", () => {
    expect(usageStatusLabel("completed")).toBeNull();
    expect(usageStatusLabel(undefined)).toBeNull();
    expect(usageStatusLabel("aborted")).toBe("stopped");
    expect(usageStatusLabel("error")).toBe("error");
  });
});

describe("parseTurnUsage", () => {
  it("extracts the known telemetry fields", () => {
    expect(
      parseTurnUsage({
        usage: {
          inputTokens: 10,
          cachedInputTokens: 4,
          outputTokens: 20,
          totalTokens: 30,
          reasoningTokens: 5,
          model: "gpt-4o-mini",
          latencyMs: 900,
          costUsd: 0.0001,
          status: "completed",
        },
      }),
    ).toEqual({
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 5,
      model: "gpt-4o-mini",
      latencyMs: 900,
      costUsd: 0.0001,
      status: "completed",
    });
  });

  it("keeps a null costUsd distinct from missing (unpriced model)", () => {
    const parsed = parseTurnUsage({
      usage: { totalTokens: 30, costUsd: null },
    });
    expect(parsed?.costUsd).toBeNull();
  });

  it("tolerates a legacy status-only usage (no token data)", () => {
    const parsed = parseTurnUsage({ usage: { status: "completed" } });
    expect(parsed?.totalTokens).toBeUndefined();
    expect(parsed?.status).toBe("completed");
  });

  it("returns null for absent / non-object metadata or usage", () => {
    expect(parseTurnUsage(undefined)).toBeNull();
    expect(parseTurnUsage(null)).toBeNull();
    expect(parseTurnUsage({})).toBeNull();
    expect(parseTurnUsage({ usage: null })).toBeNull();
    expect(parseTurnUsage({ usage: "x" })).toBeNull();
  });

  it("drops non-numeric token fields", () => {
    const parsed = parseTurnUsage({
      usage: { totalTokens: "lots", outputTokens: 5 },
    });
    expect(parsed?.totalTokens).toBeUndefined();
    expect(parsed?.outputTokens).toBe(5);
  });
});
