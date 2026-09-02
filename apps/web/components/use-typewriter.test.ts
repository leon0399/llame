// @vitest-environment jsdom

/**
 * Headless hook logic, so it lives in a jsdom suite rather than a story
 * (docs/testing.md rule 5): the interesting part is the timer chain, which a
 * play function could only observe through a rendered row.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sharedPrefixLength, useTypewriter } from "./use-typewriter";

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
function settle(ms = 5000) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("sharedPrefixLength", () => {
  it("returns the shared head length", () => {
    expect(sharedPrefixLength("foobar", "fooqux")).toBe(3);
    expect(sharedPrefixLength("foo", "foobar")).toBe(3);
    expect(sharedPrefixLength("foobar", "foo")).toBe(3);
    expect(sharedPrefixLength("abc", "xyz")).toBe(0);
    expect(sharedPrefixLength("", "x")).toBe(0);
  });
});

describe("useTypewriter", () => {
  it("shows the first value immediately — there is nothing to replace yet", () => {
    const { result } = renderHook(() => useTypewriter("New chat"));

    expect(result.current).toBe("New chat");
  });

  it("deletes only down to the common prefix before typing the rest", () => {
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "foobar" } },
    );

    rerender({ title: "fooqux" });

    // First tick drops the trailing divergent char — the shared `foo` stays.
    expect(result.current).toBe("fooba");
    expect(result.current.startsWith("foo")).toBe(true);

    settle(200);
    expect(result.current.startsWith("foo")).toBe(true);

    settle();
    expect(result.current).toBe("fooqux");
  });

  it("skips delete when the new title extends the old one", () => {
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "foo" } },
    );

    rerender({ title: "foobar" });

    expect(result.current).toBe("foob");
    settle();
    expect(result.current).toBe("foobar");
  });

  it("only deletes when the new title is a prefix of the old one", () => {
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "foobar" } },
    );

    rerender({ title: "foo" });

    expect(result.current).toBe("fooba");
    settle();
    expect(result.current).toBe("foo");
  });

  it("still fully replaces titles with no shared prefix", () => {
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "New chat" } },
    );

    rerender({ title: "Acme relaunch" });

    expect(result.current).toBe("New cha");
    expect("Acme relaunch".startsWith(result.current)).toBe(false);

    settle(200);
    expect(result.current.length).toBeGreaterThan(0);
    expect("Acme relaunch".startsWith(result.current)).toBe(true);

    settle();
    expect(result.current).toBe("Acme relaunch");
  });

  it("replaces emoji by whole code points, never a lone surrogate", () => {
    const { result, rerender } = renderHook(
      ({ title }) => useTypewriter(title),
      { initialProps: { title: "😀" } },
    );

    rerender({ title: "😁" });

    // First delete tick clears the whole emoji — not half a surrogate pair.
    expect(result.current).toBe("");
    settle();
    expect(result.current).toBe("😁");
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
