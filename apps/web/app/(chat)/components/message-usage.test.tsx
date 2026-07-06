// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { toChatUiMessages } from "@/lib/services/chat/history";

import {
  MessageUsage,
  buildUsageLine,
  formatCost,
  parseTurnUsage,
  usageStatusLabel,
} from "./message-usage";

// jsdom has no ResizeObserver; Radix's Popper-based Tooltip content measures
// itself on mount and throws without one. A minimal no-op stub is enough —
// this component doesn't assert on measured size.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

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

describe("buildUsageLine", () => {
  const line = (usage: Record<string, unknown>) =>
    buildUsageLine(parseTurnUsage({ usage }));

  it("leads with the model display name, then tokens", () => {
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

  it("does not repeat the model in the tooltip rows", () => {
    const result = line({ model: "gpt-4o", totalTokens: 30, outputTokens: 20 });
    expect(result?.rows.map((r) => r.label)).not.toContain("gpt-4o");
    expect(result?.rows).toContainEqual({ label: "Output", value: "20" });
  });

  it("omits a Cached row when caching was not used (the common case)", () => {
    const result = line({
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 20,
      totalTokens: 30,
    });
    expect(result?.rows.map((r) => r.label)).not.toContain("Cached");
  });

  it("includes a Cached row once caching is actually used", () => {
    const result = line({
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 20,
      totalTokens: 30,
    });
    expect(result?.rows).toContainEqual({ label: "Cached", value: "4" });
  });

  it("distinguishes a reasoning model that used 0 reasoning tokens from one that never reasons", () => {
    const withZeroReasoning = line({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 0,
    });
    expect(withZeroReasoning?.rows).toContainEqual({
      label: "Reasoning",
      value: "0",
    });

    const withoutReasoningField = line({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
    expect(withoutReasoningField?.rows.map((r) => r.label)).not.toContain(
      "Reasoning",
    );
  });

  it("adds a Context row for a known model, as inputTokens / catalog contextWindow", () => {
    const result = line({
      model: "gpt-4o", // catalog contextWindow: 128000
      inputTokens: 12_800,
      outputTokens: 20,
      totalTokens: 12_820,
    });
    expect(result?.rows).toContainEqual({
      label: "Context",
      value: "12,800 / 128,000 (10%)",
    });
  });

  it("omits the Context row for a model not in the static catalog", () => {
    const result = line({
      model: "acme:custom-7b",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
    expect(result?.rows.map((r) => r.label)).not.toContain("Context");
  });
});

describe("reload parity (live message-metadata vs. history)", () => {
  // The exact persisted shape (apps/api/src/chats/turn-telemetry.ts's
  // TurnTelemetry, verbatim in `messages.usage`): includes `model`, which is
  // what makes this a genuine end-to-end proof, not just a token-fields check.
  const persistedTelemetry = {
    inputTokens: 12_800,
    cachedInputTokens: 0,
    outputTokens: 20,
    totalTokens: 12_820,
    reasoningTokens: 0,
    model: "gpt-4o",
    provider: "openai",
    latencyMs: 900,
    finishReason: "stop",
    status: "completed",
    costUsd: 0.001,
  };

  it("renders the identical usage line whether the metadata came from a live message-metadata chunk or a reloaded history response", () => {
    // Live path: the run-stream-bridge emits `{ type: 'message-metadata',
    // messageMetadata: { usage: telemetry } }`, which useChat lands directly
    // on `message.metadata`.
    const liveMetadata = { usage: persistedTelemetry };
    const liveLine = buildUsageLine(parseTurnUsage(liveMetadata));

    // Reload path: GET /chats/:id/messages returns the SAME persisted
    // telemetry as `usage` on the message row; toChatUiMessages carries it
    // into `metadata.usage` the same way.
    const [historyMessage] = toChatUiMessages({
      messages: [
        {
          id: "assistant-message",
          chatId: "chat-1",
          seq: 2,
          role: "assistant",
          senderUserId: null,
          parts: [{ type: "text", text: "hi" }],
          attachments: [],
          usage: persistedTelemetry,
          inReplyTo: "user-message",
          createdAt: "2026-07-06T12:00:00.000Z",
        },
      ],
    });
    const historyLine = buildUsageLine(
      parseTurnUsage(historyMessage?.metadata),
    );

    expect(historyLine).toEqual(liveLine);
    // Pin the actual visible content too, not just structural equality — a
    // reloaded chat shows the model, tokens, cost, and latency exactly as it
    // did live.
    expect(historyLine?.text).toBe("GPT-4o · 12,820 tokens · ~$0.0010 · 900ms");
    expect(historyLine?.rows).toContainEqual({
      label: "Context",
      value: "12,800 / 128,000 (10%)",
    });
  });
});

describe("MessageUsage", () => {
  it("shows the model-led visible label as the tooltip trigger", () => {
    render(
      <MessageUsage
        metadata={{
          usage: {
            model: "gpt-4o",
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            status: "completed",
          },
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Message usage" }).textContent,
    ).toBe("GPT-4o · 30 tokens");
  });

  it("reveals the structured breakdown, including Context, on hover", async () => {
    const user = userEvent.setup();
    render(
      <MessageUsage
        metadata={{
          usage: {
            model: "gpt-4o",
            inputTokens: 12_800,
            outputTokens: 20,
            totalTokens: 12_820,
            status: "completed",
          },
        }}
      />,
    );

    await user.hover(screen.getByRole("button", { name: "Message usage" }));

    // Radix's Popper-based tooltip content can render more than one DOM copy
    // under jsdom (positioning/measurement internals) — assert presence, not
    // uniqueness.
    expect((await screen.findAllByText("Context")).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("12,800 / 128,000 (10%)").length,
    ).toBeGreaterThan(0);
  });

  it("renders a plain label with no tooltip when there is nothing to break down", () => {
    render(
      <MessageUsage
        metadata={{
          usage: { model: "gpt-4o", status: "error" },
        }}
      />,
    );
    expect(screen.getByText("GPT-4o · error")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for a legacy status-only row (no tokens, no model)", () => {
    const { container } = render(
      <MessageUsage metadata={{ usage: { status: "completed" } }} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
