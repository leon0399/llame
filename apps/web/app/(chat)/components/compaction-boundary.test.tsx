// @vitest-environment jsdom

/**
 * Render-level proof for the compaction Checkpoint (#136 design pass: matches
 * Leo's design file — a pill chip between two rules that toggles an INLINE
 * result card, not a modal — see compaction-boundary.tsx's doc comment).
 *
 * Also covers the #136 read-side merge's stats rendering: the chip/card show
 * the real compression stats (message count, before/after tokens, model)
 * embedded in `GET :id/messages` when present, and fall back independently
 * to a relative timestamp when they're null (an older/seeded compaction may
 * have no `usage`).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CompactionStats } from "@/lib/services/chat/history";
import { CompactionBoundary } from "./compaction-boundary";

const NO_STATS: CompactionStats = {
  absorbedMessageCount: null,
  beforeTokens: null,
  afterTokens: null,
  model: null,
};

const COUNT_ONLY_STATS: CompactionStats = {
  absorbedMessageCount: 18,
  beforeTokens: null,
  afterTokens: null,
  model: null,
};

const FULL_STATS: CompactionStats = {
  absorbedMessageCount: 18,
  beforeTokens: 71400,
  afterTokens: 12800,
  model: "gpt-4o",
};

afterEach(() => {
  cleanup();
});

describe("CompactionBoundary", () => {
  it("renders a checkpoint chip with the 'Context compacted' label, collapsed by default", () => {
    render(
      <CompactionBoundary
        summary="The user asked about X and Y."
        createdAt="2026-07-06T00:00:00.000Z"
        stats={NO_STATS}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: /context compacted/i,
    });
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // The result card is not in the document until expanded.
    expect(screen.queryByText("The user asked about X and Y.")).toBeNull();
    expect(screen.queryByText("Compaction result")).toBeNull();
  });

  it("expands an inline result card with the plaintext summary when clicked — no modal", async () => {
    const user = userEvent.setup();
    render(
      <CompactionBoundary
        summary="Compacted: discussed the roadmap."
        createdAt="2026-07-06T00:00:00.000Z"
        stats={NO_STATS}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /context compacted/i }),
    );

    expect(screen.getByText("Compaction result")).toBeTruthy();
    expect(screen.getByText("Compacted: discussed the roadmap.")).toBeTruthy();
    expect(
      screen.getByText(/full transcript is preserved and still searchable/i),
    ).toBeTruthy();
    // Design's inline disclosure, not a Dialog overlay.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the real message count + token savings in the chip, and before→after + model in the card, when stats are present", async () => {
    const user = userEvent.setup();
    render(
      <CompactionBoundary
        summary="Compacted: discussed the roadmap."
        createdAt="2026-07-06T00:00:00.000Z"
        stats={FULL_STATS}
      />,
    );

    // 71400 - 12800 = 58600 -> "58.6k" (design's own fmtTokens formatting).
    expect(screen.getByText("18 messages · saved 58.6k tokens")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: /context compacted/i }),
    );

    expect(screen.getByText("71.4k → 12.8k tokens · gpt-4o")).toBeTruthy();
  });

  it("falls back to the message count alone in the chip when token stats are absent", () => {
    render(
      <CompactionBoundary
        summary="Compacted."
        createdAt="2026-07-06T00:00:00.000Z"
        stats={COUNT_ONLY_STATS}
      />,
    );

    expect(screen.getByText("18 messages")).toBeTruthy();
  });

  it("falls back to a relative timestamp in BOTH the chip and the card when no stats are derivable at all", async () => {
    const user = userEvent.setup();
    render(
      <CompactionBoundary
        summary="Compacted."
        createdAt={new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()}
        stats={NO_STATS}
      />,
    );

    expect(screen.getByText(/2 hours ago/i)).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: /context compacted/i }),
    );

    // Both slots show the same relative time — two separate elements, not a
    // literal duplicate string check (getByText would throw on ambiguity).
    expect(screen.getAllByText(/2 hours ago/i).length).toBe(2);
  });
});
