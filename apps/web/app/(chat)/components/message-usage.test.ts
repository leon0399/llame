import { describe, expect, it } from "vitest";

import {
  buildUsageLine,
  parseTurnUsage,
  usageStatusLabel,
} from "./message-usage";

describe("usageStatusLabel", () => {
  it("labels non-completed turns and leaves completed unlabeled", () => {
    expect(usageStatusLabel("completed")).toBeNull();
    expect(usageStatusLabel(undefined)).toBeNull();
    expect(usageStatusLabel("aborted")).toBe("stopped");
    expect(usageStatusLabel("error")).toBe("error");
  });
});

describe("buildUsageLine", () => {
  const line = (usage: Record<string, unknown>) =>
    buildUsageLine(parseTurnUsage({ usage }));

  it("leads with the model name, then tokens", () => {
    expect(line({ model: "gpt-4o", totalTokens: 100 })?.text).toBe(
      "GPT-4o · 100 tokens",
    );
  });

  it("shows the model on a token-less errored turn (regenerate-with-X that failed)", () => {
    expect(line({ model: "gpt-4o", status: "error" })?.text).toBe(
      "GPT-4o · error",
    );
  });

  it("renders token-only when there's no model (legacy/historical turn)", () => {
    expect(line({ totalTokens: 50 })?.text).toBe("50 tokens");
  });

  it("returns null when there is neither tokens nor a model", () => {
    expect(line({ status: "completed" })).toBeNull();
    expect(buildUsageLine(null)).toBeNull();
  });

  it("does not repeat the model in the hover breakdown", () => {
    const result = line({ model: "gpt-4o", totalTokens: 30, outputTokens: 20 });
    expect(result?.breakdown).not.toContain("gpt-4o");
    expect(result?.breakdown).toContain("20 out");
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
