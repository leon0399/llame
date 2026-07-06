// @vitest-environment jsdom

/**
 * Render-level proof for the compaction Checkpoint (#136 design pass: matches
 * Leo's design file — a pill chip between two rules that toggles an INLINE
 * result card, not a modal — see compaction-boundary.tsx's doc comment).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CompactionBoundary } from "./compaction-boundary";

afterEach(() => {
  cleanup();
});

describe("CompactionBoundary", () => {
  it("renders a checkpoint chip with the 'Context compacted' label, collapsed by default", () => {
    render(
      <CompactionBoundary
        summary="The user asked about X and Y."
        createdAt="2026-07-06T00:00:00.000Z"
      />,
    );

    const trigger = screen.getByRole("button", { name: /context compacted/i });
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
});
