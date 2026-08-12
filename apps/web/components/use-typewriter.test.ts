// @vitest-environment jsdom

/**
 * Headless hook logic, so it lives in a jsdom suite rather than a story
 * (docs/testing.md rule 5): the interesting part is the timer chain, which a
 * play function could only observe through a rendered row.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTypewriter } from "./use-typewriter";

// jsdom doesn't implement matchMedia, which the hook reads for
// prefers-reduced-motion. Mutable so a test can flip the preference.
let reducedMotion = false;

function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
}

beforeEach(() => {
  reducedMotion = false;
  window.matchMedia = (query: string) =>
    mediaQueryList(
      query,
      query.includes("prefers-reduced-motion") && reducedMotion,
    );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Drain the chain; each character schedules at most 30ms. */
function settle(ms = 5_000) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useTypewriter", () => {
  it("shows the first value immediately — there is nothing to replace yet", () => {
    const { result } = renderHook(() => useTypewriter("New chat"));

    expect(result.current).toBe("New chat");
  });

  it("deletes the old title before typing the new one", () => {
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "New chat" } },
    );

    rerender({ title: "Acme relaunch" });

    // The run starts inside the effect, so by the time the rerender settles a
    // character is already gone — and the new title has not been jumped to.
    expect(result.current).toBe("New cha");
    expect("Acme relaunch".startsWith(result.current)).toBe(false);

    // Mid-run the old title is gone and the new one is arriving a character
    // at a time, so what is on screen is a prefix of the target.
    settle(200);
    expect(result.current.length).toBeGreaterThan(0);
    expect("Acme relaunch".startsWith(result.current)).toBe(true);

    settle();
    expect(result.current).toBe("Acme relaunch");
  });

  it("redirects a run already in flight instead of racing a second one", () => {
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "New chat" } },
    );

    rerender({ title: "First generated title" });
    settle(120);
    rerender({ title: "Second" });
    settle();

    expect(result.current).toBe("Second");
  });

  it("passes the target straight through under reduced motion", () => {
    reducedMotion = true;
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "New chat" } },
    );

    rerender({ title: "Acme relaunch" });

    // No timers to advance: the change lands on the same tick.
    expect(result.current).toBe("Acme relaunch");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the target straight through when disabled", () => {
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title, { enabled: false }),
      { initialProps: { title: "New chat" } },
    );

    rerender({ title: "Acme relaunch" });

    expect(result.current).toBe("Acme relaunch");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer running after unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "New chat" } },
    );

    rerender({ title: "Acme relaunch" });
    act(() => {
      vi.advanceTimersByTime(30);
    });
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
