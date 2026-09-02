// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useLatestRef } from "./use-latest-ref";

describe("useLatestRef", () => {
  it("exposes the value from the most recent render", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLatestRef(value),
      {
        initialProps: { value: "first" },
      },
    );

    expect(result.current.current).toBe("first");

    rerender({ value: "second" });
    expect(result.current.current).toBe("second");
  });

  // The regression this hook exists for: a callback captured ONCE — the chat
  // transport is built per chat id and never replaced — must still read the
  // current value. A hand-written ref that skipped the per-render assignment
  // pinned the first value forever, silently.
  it("is read correctly by a callback captured on the first render", () => {
    let captured: (() => string | undefined) | undefined;

    const { rerender } = renderHook(
      ({ value }) => {
        const ref = useLatestRef(value);
        captured ??= () => ref.current;
      },
      // SAFETY: widens the literal `undefined` initial prop so
      // `renderHook`'s inferred prop type allows the later
      // `rerender({ value: "xhigh" })` call — no value narrowing involved.
      { initialProps: { value: undefined as string | undefined } },
    );

    expect(captured?.()).toBeUndefined();

    rerender({ value: "xhigh" });
    expect(captured?.()).toBe("xhigh");
  });

  it("keeps the same ref object across renders", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLatestRef(value),
      {
        initialProps: { value: 1 },
      },
    );
    const first = result.current;

    rerender({ value: 2 });
    expect(result.current).toBe(first);
  });
});
