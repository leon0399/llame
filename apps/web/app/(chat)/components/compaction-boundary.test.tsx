// @vitest-environment jsdom

/**
 * Render-level proof for the compaction Checkpoint + modal (#136 rework: the
 * boundary must be a clearly visible timeline element, not a subtle inline
 * expander — see compaction-boundary.tsx's doc comment). Mirrors the Radix
 * Dialog jsdom harness already established by command-palette.render.test.tsx
 * and share-chat-dialog's usage of @workspace/ui's Dialog.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CompactionBoundary } from "./compaction-boundary";

beforeAll(() => {
  // jsdom doesn't implement the Pointer Events capture API Radix's Dialog
  // relies on for open/close + focus handling.
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        value: () => false,
        writable: true,
      });
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
});

describe("CompactionBoundary", () => {
  it("renders a checkpoint marker with the summarized-context label", () => {
    render(<CompactionBoundary summary="The user asked about X and Y." />);

    expect(
      screen.getByRole("button", {
        name: /earlier messages summarized for context/i,
      }),
    ).toBeTruthy();
    // The modal content is not in the document until opened.
    expect(screen.queryByText("The user asked about X and Y.")).toBeNull();
  });

  it("opens a modal with the plaintext summary when the checkpoint is clicked", async () => {
    const user = userEvent.setup();
    render(<CompactionBoundary summary="Compacted: discussed the roadmap." />);

    await user.click(
      screen.getByRole("button", {
        name: /earlier messages summarized for context/i,
      }),
    );

    expect(
      screen.getByRole("dialog", { name: /compacted conversation summary/i }),
    ).toBeTruthy();
    expect(screen.getByText("Compacted: discussed the roadmap.")).toBeTruthy();
  });
});
