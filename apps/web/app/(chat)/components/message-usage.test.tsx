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

const MODELS = [
  {
    id: "system:openai:gpt-4o",
    source: "system" as const,
    name: "GPT-4o",
    contextWindowTokens: 128_000,
  },
];

// jsdom has no ResizeObserver; Base UI's Popper-based HoverCard content
// measures itself on mount and throws without one. A minimal no-op stub is
// enough — this component doesn't assert on measured size.
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
          modelId: "system:openai:gpt-4o-mini",
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
      modelId: "system:openai:gpt-4o-mini",
      latencyMs: 900,
      costUsd: 0.0001,
      status: "completed",
    });
  });

  it("does not read legacy model/provider fields", () => {
    expect(
      parseTurnUsage({
        usage: {
          model: "gpt-4o",
          provider: "openai",
          status: "completed",
        },
      })?.modelId,
    ).toBeUndefined();
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
    expect(formatCost(0.00003)).toBe("<$0.0001");
  });

  it("shows 4-decimal precision below a cent", () => {
    expect(formatCost(0.0001)).toBe("$0.0001");
    expect(formatCost(0.0034)).toBe("$0.0034");
  });

  it("shows 3-decimal precision at or above a cent, below a dollar", () => {
    expect(formatCost(0.01)).toBe("$0.010");
    expect(formatCost(0.05)).toBe("$0.050");
  });

  it("shows 2-decimal precision at or above a dollar", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("does not apply the sub-mill fallback to an exact zero", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });
});

describe("buildUsageLine", () => {
  const line = (usage: Record<string, unknown>) =>
    buildUsageLine(parseTurnUsage({ usage }), MODELS);

  it("shows model and total time, not tokens/cost, in the visible text", () => {
    expect(
      line({
        modelId: "system:openai:gpt-4o",
        latencyMs: 900,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        costUsd: 0.01,
      })?.text,
    ).toBe("GPT-4o · 900ms");
  });

  it("falls back to the opaque model id when no loaded model name exists", () => {
    expect(
      buildUsageLine(
        parseTurnUsage({ usage: { modelId: "openrouter:openai:o3-pro" } }),
        MODELS,
      )?.text,
    ).toBe("openrouter:openai:o3-pro");
  });

  it("renders seconds with 2 decimal places past 1s", () => {
    expect(
      line({ modelId: "system:openai:gpt-4o", latencyMs: 1234 })?.text,
    ).toBe("GPT-4o · 1.23s");
  });

  it("prefixes a stopped/error label before the model", () => {
    expect(
      line({
        modelId: "system:openai:gpt-4o",
        latencyMs: 500,
        status: "aborted",
      })?.text,
    ).toBe("stopped · GPT-4o · 500ms");
    expect(
      line({ modelId: "system:openai:gpt-4o", status: "error" })?.text,
    ).toBe("error · GPT-4o");
  });

  it("degrades to a token-only shape for a legacy turn with no model", () => {
    expect(line({ totalTokens: 50 })?.text).toBe("50 tokens");
  });

  it("returns null when there is neither tokens nor a model", () => {
    expect(line({ status: "completed" })).toBeNull();
    expect(buildUsageLine(null)).toBeNull();
  });

  it("puts Total under a Performance section, keyed to latencyMs", () => {
    const result = line({ modelId: "system:openai:gpt-4o", latencyMs: 1500 });
    expect(result?.sections).toContainEqual({
      header: "Performance",
      rows: [{ label: "Total", value: "1.50s" }],
    });
  });

  it("always includes 'of which cached', even at zero (matches the design's row set)", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 20,
    });
    const tokens = result?.sections.find((s) => s.header === "Tokens");
    expect(tokens?.rows).toContainEqual({
      label: "of which cached",
      value: "0",
    });
  });

  it("always includes Reasoning, defaulting to 0 for a non-reasoning model", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      inputTokens: 10,
      outputTokens: 20,
    });
    const tokens = result?.sections.find((s) => s.header === "Tokens");
    expect(tokens?.rows).toContainEqual({ label: "Reasoning", value: "0" });
  });

  it("abbreviates large token counts (1.5k, 1.2M)", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      inputTokens: 1500,
      outputTokens: 1_234_000,
    });
    const tokens = result?.sections.find((s) => s.header === "Tokens");
    expect(tokens?.rows).toContainEqual({ label: "Input", value: "1.5k" });
    expect(tokens?.rows).toContainEqual({ label: "Output", value: "1.2M" });
  });

  it("puts Model, Total tokens, and Est. cost under Cost & model", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.05,
    });
    expect(result?.sections).toContainEqual({
      header: "Cost & model",
      rows: [
        { label: "Model", value: "GPT-4o" },
        { label: "Total tokens", value: "30" },
        { label: "Est. cost", value: "$0.050" },
      ],
    });
  });

  it("omits Est. cost entirely for an unpriced model (never a fake $0)", () => {
    const result = line({
      modelId: "acme:custom-7b",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: null,
    });
    const costSection = result?.sections.find(
      (s) => s.header === "Cost & model",
    );
    expect(costSection?.rows.map((r) => r.label)).not.toContain("Est. cost");
  });
});

describe("reload parity (live message-metadata vs. history)", () => {
  const persistedTelemetry = {
    inputTokens: 12_800,
    cachedInputTokens: 0,
    outputTokens: 20,
    totalTokens: 12_820,
    reasoningTokens: 0,
    modelId: "system:openai:gpt-4o",
    latencyMs: 900,
    finishReason: "stop",
    status: "completed",
    costUsd: 0.001,
  };

  it("renders the identical usage line whether the metadata came from a live message-metadata chunk or a reloaded history response", () => {
    const liveMetadata = { usage: persistedTelemetry };
    const liveLine = buildUsageLine(parseTurnUsage(liveMetadata), MODELS);

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
      MODELS,
    );

    expect(historyLine).toEqual(liveLine);
    expect(historyLine?.text).toBe("GPT-4o · 900ms");
    expect(historyLine?.sections).toContainEqual({
      header: "Cost & model",
      rows: [
        { label: "Model", value: "GPT-4o" },
        { label: "Total tokens", value: "12.8k" },
        { label: "Est. cost", value: "$0.0010" },
      ],
    });
  });
});

describe("MessageUsage", () => {
  it("shows the model + total time as the hover-card trigger's visible text", () => {
    render(
      <MessageUsage
        metadata={{
          usage: {
            modelId: "system:openai:gpt-4o",
            latencyMs: 900,
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            status: "completed",
          },
        }}
        models={MODELS}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^Message usage:/ }).textContent,
    ).toBe("GPT-4o · 900ms");
  });

  it("reveals the Performance / Tokens / Cost & model sections on hover", async () => {
    const user = userEvent.setup();
    render(
      <MessageUsage
        metadata={{
          usage: {
            modelId: "system:openai:gpt-4o",
            latencyMs: 900,
            inputTokens: 12_800,
            outputTokens: 20,
            totalTokens: 12_820,
            costUsd: 0.01,
            status: "completed",
          },
        }}
        models={MODELS}
      />,
    );

    await user.hover(screen.getByRole("button", { name: /^Message usage:/ }));

    expect((await screen.findAllByText("Performance")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cost & model").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Est. cost").length).toBeGreaterThan(0);
  });

  it("stays an interactive hover-card trigger even for a token-less errored turn, still revealing which model was tried", async () => {
    const user = userEvent.setup();
    render(
      <MessageUsage
        metadata={{
          usage: { modelId: "system:openai:gpt-4o", status: "error" },
        }}
        models={MODELS}
      />,
    );
    const trigger = screen.getByRole("button", { name: /^Message usage:/ });
    expect(trigger.textContent).toBe("error · GPT-4o");

    await user.hover(trigger);

    expect((await screen.findAllByText("Model")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("GPT-4o").length).toBeGreaterThan(0);
  });

  it("renders nothing for a legacy status-only row (no tokens, no modelId)", () => {
    const { container } = render(
      <MessageUsage metadata={{ usage: { status: "completed" } }} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
