"use client";

import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { Spinner } from "@workspace/ui/components/spinner";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useLatestRef } from "@/lib/hooks/use-latest-ref";
import { CHAT_SCROLLER_SELECTOR } from "@/lib/services/chat/prehydration-pin";

// Start fetching an older page while the reader is still this many pixels away
// from the loaded history's top, so scrolling up feels endless instead of
// hitting an edge and waiting.
const PREFETCH_MARGIN_PX = 800;

/**
 * Endless upward history loading (#187). Renders a sentinel above the oldest
 * loaded message; when the reader scrolls it into a prefetch band above the
 * viewport, the next (strictly older) page is requested. Must live inside a
 * `Conversation` — it reads the scroller and stick-to-bottom state from
 * use-stick-to-bottom's context.
 *
 * Three scroll-physics duties beyond triggering the fetch:
 *
 * - The mount layout effect pins the scroller to the bottom BEFORE the first
 *   paint. The library's own initial scroll runs from its ResizeObserver
 *   callback via a deferred scrollToBottom, which paints at least one frame
 *   at the TOP of the loaded window first — visible as a flash on
 *   client-side navigation, where the whole transcript mounts in one commit.
 * - The `escapedFromLock` gate ensures only a reader who DELIBERATELY
 *   scrolled up can trigger a load: the library sets it exclusively from
 *   user input (an upward wheel/scroll or a text selection), never from
 *   mount, hydration, resize catch-up, or animation frames. Geometry-based
 *   gates (`isAtBottom`, viewport math) all have windows during load where
 *   deferred markdown popping in makes the page momentarily look
 *   "scrolled up" and self-fires a fetch.
 * - Prepending an older page grows the content ABOVE the viewport, which the
 *   library only compensates when stuck to the bottom — from the reader's
 *   position it would shove the transcript down by a full page. The layout
 *   effect re-anchors: it tracks the previously-oldest message's element (by
 *   `data-message-key`) and shifts scrollTop by exactly how far the prepend
 *   pushed that element, before the browser paints. Native scroll anchoring
 *   is turned off so engines that support it can't fight the manual math.
 *
 * memo: the parent re-renders on every streamed token; all four props are
 * stable across those commits, so memo skips this whole component (and its
 * per-commit anchor measurement) during streaming.
 */
export const ChatLoadOlder = memo(function ChatLoadOlder({
  hasOlder,
  isLoading,
  onLoadOlder,
  oldestMessageKey,
}: {
  hasOlder: boolean;
  isLoading: boolean;
  onLoadOlder: () => void;
  oldestMessageKey: string | null;
}) {
  const { contentRef, scrollRef, isAtBottom, escapedFromLock, state } =
    useStickToBottomContext();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observed = useLatestRef({ escapedFromLock, isLoading, onLoadOlder });

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.style.overflowAnchor = "none";
  }, [scrollRef]);

  // Pre-paint bottom pin (see the component JSDoc). Layout effects run
  // before the browser paints the commit, so the reader never sees the
  // top-anchored frame the library's deferred initial scroll leaves. Later
  // commits are the library's (streaming growth) or the anchor effect's
  // (prepends) to position.
  const pinnedRef = useRef(false);
  useLayoutEffect(() => {
    if (pinnedRef.current) return;
    // React owns scroll positioning from here — retire the SSR inline pin
    // (covers only the pre-hydration frames; see prehydration-pin.ts).
    window.__llameChatPinStop?.();
    // Reader already left the bottom during the pre-hydration window —
    // honor that escape instead of yanking them back to newest.
    if (window.__llameChatPinEscaped) {
      window.__llameChatPinEscaped = undefined;
      pinnedRef.current = true;
      return;
    }
    // Pin on the FIRST commit that has transcript content, before it paints.
    // On a hard reload that is the hydration commit; on client-side
    // navigation the remounted transcript's first content commit — which the
    // library only chases via a deferred scrollToBottom, painting frames at
    // the TOP of the chat first.
    if (oldestMessageKey === null) return;
    // The DOM is queried directly (same selector as prehydration-pin.ts):
    // in this commit the library's scrollRef is NOT attached yet — child
    // layout effects run before ancestor host refs attach — while the node
    // itself is committed and fully laid out. For the same reason the raw
    // scrollTop write cannot be misread as user scrolling (no listener yet),
    // and on the paths where one IS attached, a downward scroll never
    // mutates the escaped-from-lock gate. The overflow style is the exact
    // one the library applies; pre-attachment the scroller still has the
    // SSR default ("visible"), under which scrollTop writes silently no-op.
    const scroller = document.querySelector<HTMLElement>(
      CHAT_SCROLLER_SELECTOR,
    );
    if (!scroller) return;
    if (getComputedStyle(scroller).overflow === "visible") {
      scroller.style.overflow = "auto";
    }
    scroller.scrollTop = scroller.scrollHeight;
    pinnedRef.current = true;
  }, [oldestMessageKey]);

  const anchorRef = useRef<{
    key: string;
    element: HTMLElement;
    offsetTop: number;
  } | null>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    // dataset comparison instead of an attribute selector: keys need no
    // escaping, and jsdom lacks CSS.escape.
    const messageElement = (key: string) =>
      content
        ? ([
            ...content.querySelectorAll<HTMLElement>("[data-message-key]"),
          ].find((element) => element.dataset.messageKey === key) ?? null)
        : null;

    const previous = anchorRef.current;
    if (
      previous &&
      oldestMessageKey !== null &&
      previous.key !== oldestMessageKey &&
      !isAtBottom
    ) {
      // The previously-oldest element is still mounted after a prepend
      // (React keys are stable) — the cached handle avoids re-scanning.
      const element = previous.element.isConnected
        ? previous.element
        : messageElement(previous.key);
      if (element) {
        state.scrollTop =
          state.scrollTop + (element.offsetTop - previous.offsetTop);
      }
    }

    // Reuse the cached handle when the key is unchanged (the common commit);
    // a full scan only runs when the oldest message actually changed.
    const oldestElement =
      oldestMessageKey === null
        ? null
        : previous?.key === oldestMessageKey && previous.element.isConnected
          ? previous.element
          : messageElement(oldestMessageKey);
    anchorRef.current =
      oldestMessageKey !== null && oldestElement
        ? {
            key: oldestMessageKey,
            element: oldestElement,
            offsetTop: oldestElement.offsetTop,
          }
        : null;
  });

  // Recreated whenever the oldest message changes: observe() always reports
  // the current intersection, so a reader parked near the top chain-loads
  // page after page without needing to move again.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroller = scrollRef.current;
    if (!sentinel || !scroller || !hasOlder) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const { escapedFromLock, isLoading, onLoadOlder } = observed.current;
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!escapedFromLock || isLoading) return;
        onLoadOlder();
      },
      { root: scroller, rootMargin: `${PREFETCH_MARGIN_PX}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRef, hasOlder, oldestMessageKey, observed]);

  // TODO(#187): when the walk exhausts (hasOlder flips false at the chat's
  // first message) this box unmounts and the transcript shifts up by its
  // 32px, uncompensated — a one-time nudge at the very top of history.
  // Reserve the box once loaded-at-least-once if it ever grates.
  if (!hasOlder) return null;

  // Fixed height whether or not the spinner shows, so toggling the loading
  // state cannot shift the layout the anchor math just measured.
  return (
    <div
      ref={sentinelRef}
      data-testid="chat-load-older"
      className="flex h-8 items-center justify-center"
    >
      {isLoading && (
        <Spinner
          aria-label="Loading older messages"
          className="text-muted-foreground"
        />
      )}
    </div>
  );
});
