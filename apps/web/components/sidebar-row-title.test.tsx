// @vitest-environment jsdom

/**
 * The one case the stories cannot reach: Chromium always has a ResizeObserver,
 * and jsdom ships none, so only here does the overflow sync's guard run. The
 * rest of SidebarRowTitle is covered by sidebar-row-title.stories.tsx.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SidebarRowTitle } from "./sidebar-row-title";

beforeEach(() => {
  // jsdom ships no matchMedia; useTypewriter's reduced-motion read needs one
  // to mount, not to animate. Only the members it reads are implemented.
  function fakeMatchMedia(media: string) {
    return {
      matches: false,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
  vi.stubGlobal("matchMedia", fakeMatchMedia);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

it("renders the text plainly without a ResizeObserver", () => {
  expect("ResizeObserver" in globalThis).toBe(false);

  render(<SidebarRowTitle text="Untitled chat" />);

  const text = screen.getByText("Untitled chat");
  expect(text.parentElement?.dataset.clipped).toBeUndefined();
});
