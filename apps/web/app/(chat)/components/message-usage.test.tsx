// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { toChatUiMessages } from "@/lib/services/chat/history";

import {
  MessageUsage,
  buildUsageLine,
  formatCost,
  parseTurnUsage,
  usageStatusLabel,
  type TurnUsage,
} from "./message-usage";

const MODELS = [
  {
    id: "system:openai:gpt-4o",
    source: "system" as const,
    name: "GPT-4o",
    contextWindowTokens: 128_000,
    reasoning: {
      effortLevels: [
        { value: "none" },
        { value: "xhigh", label: "Extra High" },
      ],
      defaultEffort: "none",
      cacheInvalidatedByEffortChange: false,
    },
  },
];

// jsdom has no ResizeObserver; Base UI's Popper-based HoverCard content
// measures itself on mount and throws without one. A minimal no-op stub is
// enough — this component doesn't assert on measured size.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        constructor(_callback: ResizeObserverCallback) {}
        observe(_target: Element, _options?: ResizeObserverOptions): void {}
        unobserve(_target: Element): void {}
        disconnect(): void {}
      },
    );
  }
});

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
          cacheWriteTokens: 6,
          outputTokens: 20,
          totalTokens: 30,
          reasoningTokens: 5,
          modelId: "system:openai:gpt-4o-mini",
          latencyMs: 900,
          costUsd: 0.0001,
          status: "completed",
          complete: true,
          billing: "usage",
        },
      }),
    ).toEqual({
      inputTokens: 10,
      cachedInputTokens: 4,
      cacheWriteTokens: 6,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 5,
      modelId: "system:openai:gpt-4o-mini",
      latencyMs: 900,
      costUsd: 0.0001,
      status: "completed",
      complete: true,
      billing: "usage",
    });
  });

  it("ignores invalid completeness and billing marker values", () => {
    const parsed = parseTurnUsage({
      usage: { complete: "false", billing: "subscription-like" },
    });
    expect(parsed?.complete).toBeUndefined();
    expect(parsed?.billing).toBeUndefined();
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
  const line = (usage: Partial<TurnUsage>) =>
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

  it("shows a catalog effort label in the badge and at-effort row", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      effort: "xhigh",
      latencyMs: 900,
    });
    expect(result?.text).toBe("GPT-4o · Extra High · 900ms");
    expect(
      result?.sections
        .find((s) => s.header === "Cost & model")
        ?.rows.find((r) => r.label === "at effort"),
    ).toEqual({ label: "at effort", value: "Extra High" });
  });

  it("falls back to the raw effort token when unlabeled or unknown", () => {
    expect(
      line({
        modelId: "system:openai:gpt-4o",
        effort: "none",
        latencyMs: 100,
      })?.text,
    ).toBe("GPT-4o · none · 100ms");
    expect(
      line({
        modelId: "system:openai:gpt-4o",
        effort: "gone",
        latencyMs: 100,
      })?.text,
    ).toBe("GPT-4o · gone · 100ms");
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

  it("shows cache-write tokens as an 'of which cache write' subset row of Input", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      inputTokens: 12_800,
      cachedInputTokens: 0,
      cacheWriteTokens: 11_200,
      outputTokens: 20,
    });
    const tokens = result?.sections.find((s) => s.header === "Tokens");
    expect(tokens?.rows).toContainEqual({
      label: "of which cache write",
      value: "11.2k",
    });
  });

  it("omits the cache-write row for a turn whose telemetry predates the field", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      inputTokens: 10,
      outputTokens: 20,
    });
    const tokens = result?.sections.find((s) => s.header === "Tokens");
    expect(tokens?.rows.map((r) => r.label)).not.toContain(
      "of which cache write",
    );
  });

  it("shows unknown reasoning as unavailable beneath Output", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      inputTokens: 10,
      outputTokens: 20,
    });
    const rows = result?.sections.find(
      (section) => section.header === "Tokens",
    )?.rows;
    expect(rows).toContainEqual({ label: "of which reasoning", value: "—" });
    expect(rows?.[rows.findIndex((row) => row.label === "Output") + 1]).toEqual(
      { label: "of which reasoning", value: "—" },
    );
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

  it("keeps complete metered usage formatted exactly as before", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      latencyMs: 900,
      inputTokens: 2400,
      outputTokens: 300,
      totalTokens: 2700,
      costUsd: 0.0063,
      complete: true,
      billing: "usage",
    });
    expect(result?.text).toBe("GPT-4o · 900ms");
    expect(result?.incompleteNotice).toBeUndefined();
    expect(result?.sections).toContainEqual({
      header: "Cost & model",
      rows: [
        { label: "Model", value: "GPT-4o" },
        { label: "Total tokens", value: "2.7k" },
        { label: "Est. cost", value: "$0.0063" },
      ],
    });
  });

  it("keeps historical cost as an ordinary estimate", () => {
    const result = line({
      modelId: "system:openai:gpt-4o",
      totalTokens: 30,
      costUsd: 0.0063,
    });
    expect(
      result?.sections
        .find((section) => section.header === "Cost & model")
        ?.rows.find((row) => row.label === "Est. cost"),
    ).toEqual({ label: "Est. cost", value: "$0.0063" });
  });

  it("omits cost for an unpriced subscription model", () => {
    const result = line({
      modelId: "acme:custom-7b",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: null,
      billing: "subscription",
    });
    const costSection = result?.sections.find(
      (section) => section.header === "Cost & model",
    );
    expect(costSection?.rows.map((row) => row.label)).not.toContain(
      "Notional cost",
    );
    expect(costSection?.rows.some((row) => row.value.includes("$"))).toBe(
      false,
    );
  });
});

describe("reload parity (live message-metadata vs. history)", () => {
  const persistedTelemetry = {
    inputTokens: 12_800,
    cachedInputTokens: 0,
    cacheWriteTokens: 11_200,
    outputTokens: 20,
    totalTokens: 12_820,
    reasoningTokens: 0,
    modelId: "system:openai:gpt-4o",
    latencyMs: 900,
    finishReason: "stop",
    status: "completed",
    costUsd: 0.001,
    complete: false,
    billing: "subscription",
  };

  it("renders identical incomplete subscription usage from live metadata and reloaded history", () => {
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
    expect(historyLine?.text).toBe("GPT-4o · 900ms · ≥ 12.8k tokens");
    expect(historyLine?.incompleteNotice).toBe(
      "Recorded usage may not cover all of this Run's spend",
    );
    expect(parseTurnUsage(liveMetadata)).toMatchObject({
      complete: false,
      billing: "subscription",
    });
    expect(parseTurnUsage(historyMessage?.metadata)).toMatchObject({
      complete: false,
      billing: "subscription",
    });
    expect(historyLine?.sections).toContainEqual({
      header: "Tokens",
      rows: [
        { label: "Input", value: "12.8k" },
        { label: "of which cached", value: "0" },
        { label: "of which cache write", value: "11.2k" },
        { label: "Output", value: "20" },
        { label: "of which reasoning", value: "0" },
      ],
    });
    expect(historyLine?.sections).toContainEqual({
      header: "Cost & model",
      rows: [
        { label: "Model", value: "GPT-4o" },
        { label: "Total tokens", value: "≥ 12.8k" },
        { label: "Notional cost", value: "≥ $0.0010" },
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
            complete: true,
            billing: "usage",
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
            complete: true,
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
    const totalTokensLabel = screen.getByText("Total tokens");
    expect(totalTokensLabel.parentElement?.textContent).toBe(
      "Total tokens12.8k",
    );
    const costLabel = screen.getByText("Est. cost");
    expect(costLabel.parentElement?.textContent).toBe("Est. cost$0.010");
  });

  it("shows incomplete totals and cost as lower bounds in the trigger and hover card", async () => {
    const user = userEvent.setup();
    render(
      <MessageUsage
        metadata={{
          usage: {
            modelId: "system:openai:gpt-4o",
            latencyMs: 900,
            inputTokens: 2400,
            outputTokens: 300,
            totalTokens: 2700,
            costUsd: 0.0063,
            complete: false,
            billing: "usage",
            status: "completed",
          },
        }}
        models={MODELS}
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Message usage:/ });
    expect(trigger.textContent).toBe(
      "GPT-4o · 900ms · ≥ 2.7k tokens · ≥ $0.0063",
    );
    await user.hover(trigger);

    const notice = await screen.findByText(
      "Recorded usage may not cover all of this Run's spend",
    );
    expect(notice.textContent).toBe(
      "Recorded usage may not cover all of this Run's spend",
    );
    expect(screen.getByText("≥ 2.7k").textContent).toBe("≥ 2.7k");
    expect(screen.getByText("≥ $0.0063").textContent).toBe("≥ $0.0063");
  });

  it("marks subscription cost as notional with not-billed text", async () => {
    const user = userEvent.setup();
    render(
      <MessageUsage
        metadata={{
          usage: {
            modelId: "system:openai:gpt-4o",
            inputTokens: 2400,
            outputTokens: 300,
            totalTokens: 2700,
            costUsd: 0.0063,
            complete: true,
            billing: "subscription",
          },
        }}
        models={MODELS}
      />,
    );
    await user.hover(screen.getByRole("button", { name: /^Message usage:/ }));

    expect((await screen.findByText("Notional cost")).textContent).toBe(
      "Notional cost",
    );
    const value = screen.getByText("$0.0063");
    expect(value.textContent).toBe("$0.0063, not billed");
    expect(value.classList.contains("text-muted-foreground")).toBe(true);
    expect(value.classList.contains("line-through")).toBe(true);
  });

  it("keeps incomplete subscription cost out of the trigger as a notional lower bound", async () => {
    const user = userEvent.setup();
    render(
      <MessageUsage
        metadata={{
          usage: {
            modelId: "system:openai:gpt-4o",
            inputTokens: 2400,
            outputTokens: 300,
            totalTokens: 2700,
            costUsd: 0.0063,
            complete: false,
            billing: "subscription",
          },
        }}
        models={MODELS}
      />,
    );
    const trigger = screen.getByRole("button", { name: /^Message usage:/ });
    expect(trigger.textContent).toBe("GPT-4o · ≥ 2.7k tokens");
    await user.hover(trigger);

    expect((await screen.findByText("Notional cost")).textContent).toBe(
      "Notional cost",
    );
    const value = screen.getByText("≥ $0.0063");
    expect(value.textContent).toBe("≥ $0.0063, not billed");
    expect(value.classList.contains("text-muted-foreground")).toBe(true);
    expect(value.classList.contains("line-through")).toBe(true);
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
