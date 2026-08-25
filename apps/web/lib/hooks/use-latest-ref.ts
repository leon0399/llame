"use client";

import { useRef, type RefObject } from "react";

/**
 * A ref that always holds the latest render's value.
 *
 * For reading current state from a callback that was captured ONCE and never
 * re-created — the AI SDK's chat transport is the motivating case: it is built
 * per chat id and never adopts a new instance, so a value closed over directly
 * is frozen at first render.
 *
 * This exists as a hook rather than as two adjacent lines because the two-line
 * form is quietly breakable: create the ref, forget the assignment, and the
 * value is pinned forever while every type check, lint, and unit test passes.
 * That shipped once here — a composer control whose selection never reached
 * the request. Bundling the assignment with the creation makes it
 * unrepresentable.
 *
 * Assigns during render on purpose: it is a plain latest-value mirror that
 * nothing reads during the same render pass, so an effect would only delay it
 * by a commit.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
