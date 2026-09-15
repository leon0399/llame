"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

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
 * The value is mirrored in a layout effect, not during render: reads during
 * render are not this hook's use (nothing here is rendered), a render can be
 * discarded or replayed, and React forbids touching refs while rendering. A
 * layout effect runs once the commit is real — before paint, before any
 * passive effect in the tree, and so before any event or callback could read
 * the mirror — which keeps the guarantee the two-line form was missing: the
 * first render already seeds the ref, and every later render is visible to
 * whoever reads it next.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
