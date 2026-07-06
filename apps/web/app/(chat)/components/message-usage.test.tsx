// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  MessageUsage,
  formatCost,
  parseTurnUsage,
  usageStatusLabel,
} from "./message-usage";

afterEach(() => {
  cleanup();
});

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

describe("formatCost", () => {
  it("never rounds a real, nonzero cost down to a fake $0", () => {
    // (0.00003).toFixed(4) === "0.0000" — this exact case is why the
    // sub-mill fallback exists.
    expect(formatCost(0.00003)).toBe("~<$0.0001");
  });

  it("shows 4-decimal precision for sub-cent costs at or above the fallback threshold", () => {
    expect(formatCost(0.0001)).toBe("~$0.0001");
    expect(formatCost(0.0034)).toBe("~$0.0034");
  });

  it("shows 2-decimal precision at or above a cent", () => {
    expect(formatCost(0.01)).toBe("~$0.01");
    expect(formatCost(1.5)).toBe("~$1.50");
  });

  it("does not apply the sub-mill fallback to an exact zero", () => {
    expect(formatCost(0)).toBe("~$0.0000");
  });
});

describe("MessageUsage breakdown", () => {
  it("omits '0 cached' when caching was not used (the common case)", () => {
    const { container } = render(
      <MessageUsage
        metadata={{
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 20,
            totalTokens: 30,
            model: "gpt-4o-mini",
            status: "completed",
          },
        }}
      />,
    );
    const title = container.querySelector("p")?.getAttribute("title");
    expect(title).not.toContain("cached");
  });

  it("distinguishes a reasoning model that used 0 reasoning tokens from one that never reasons", () => {
    const { container: withZeroReasoning } = render(
      <MessageUsage
        metadata={{
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            reasoningTokens: 0,
            model: "reasoning-model",
            status: "completed",
          },
        }}
      />,
    );
    expect(
      withZeroReasoning.querySelector("p")?.getAttribute("title"),
    ).toContain("0 reasoning");

    cleanup();

    const { container: withoutReasoningField } = render(
      <MessageUsage
        metadata={{
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            model: "gpt-4o-mini",
            status: "completed",
          },
        }}
      />,
    );
    expect(
      withoutReasoningField.querySelector("p")?.getAttribute("title"),
    ).not.toContain("reasoning");
  });
});
