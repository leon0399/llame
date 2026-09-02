"use client";

import { memo, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  useStickToBottomContext,
  type StickToBottomState,
} from "use-stick-to-bottom";
import { useLatestRef } from "@/lib/hooks/use-latest-ref";
import { CHAT_SCROLLER_SELECTOR } from "@/lib/services/chat/prehydration-pin";

// Start fetching an older page while the reader is still this many pixels away
// from the loaded history's top, so scrolling up feels endless instead of
// hitting an edge and waiting.
const PREFETCH_MARGIN_PX = 800;

/** Native scroll anchoring fights the manual anchor math below — keep it off. */
function useDisableScrollAnchoring(scrollRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.style.overflowAnchor = "none";
  }, [scrollRef]);
}

/** Fixed height whether or not the spinner shows, so toggling the loading
 * state cannot shift the layout the anchor math (`usePrependScrollAnchor`)
 * just measured. */
function LoadOlderSentinel({
  sentinelRef,
  isLoading,
}: {
  sentinelRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
}) {
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
}

/**
 * Pins the scroller to the bottom BEFORE the first paint (see the component
 * JSDoc: the library's own initial scroll runs deferred, painting at least
 * one top-anchored frame first on client-side navigation).
 */
function usePrePaintBottomPin(oldestMessageKey: string | null) {
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
}

// dataset comparison instead of an attribute selector: keys need no escaping,
// and jsdom lacks CSS.escape.
function findMessageElement(
  content: HTMLElement | null,
  key: string,
): HTMLElement | null {
  if (!content) return null;
  return (
    [...content.querySelectorAll<HTMLElement>("[data-message-key]")].find(
      (element) => element.dataset.messageKey === key,
    ) ?? null
  );
}

type AnchorEntry = { key: string; element: HTMLElement; offsetTop: number };

// The previously-cached entry's element is still mounted after a prepend
// (React keys are stable) — reuse the cached handle when its key matches,
// only falling back to a full DOM scan when the target key changed.
function resolveAnchorElement(
  content: HTMLElement | null,
  cached: AnchorEntry | null,
  key: string,
): HTMLElement | null {
  if (cached?.key === key && cached.element.isConnected) return cached.element;
  return findMessageElement(content, key);
}

/** The anchor entry `usePrependScrollAnchor` should remember for next time —
 *  a pure derivation, split out from the effect's scrollTop compensation. */
function nextAnchorEntry(
  content: HTMLElement | null,
  cached: AnchorEntry | null,
  oldestMessageKey: string | null,
): AnchorEntry | null {
  if (oldestMessageKey === null) return null;
  const element = resolveAnchorElement(content, cached, oldestMessageKey);
  return element
    ? { key: oldestMessageKey, element, offsetTop: element.offsetTop }
    : null;
}

/**
 * Prepending an older page grows the content ABOVE the viewport, which the
 * library only compensates when stuck to the bottom — from the reader's
 * position it would shove the transcript down by a full page. Tracks the
 * previously-oldest message's element (by `data-message-key`) and shifts
 * scrollTop by exactly how far the prepend pushed that element, before the
 * browser paints.
 */
function usePrependScrollAnchor({
  contentRef,
  oldestMessageKey,
  isAtBottom,
  state,
}: {
  contentRef: RefObject<HTMLElement | null>;
  oldestMessageKey: string | null;
  isAtBottom: boolean;
  state: StickToBottomState;
}) {
  const anchorRef = useRef<AnchorEntry | null>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    const previous = anchorRef.current;
    if (
      previous &&
      oldestMessageKey !== null &&
      previous.key !== oldestMessageKey &&
      !isAtBottom
    ) {
      const element = resolveAnchorElement(content, previous, previous.key);
      if (element) {
        state.scrollTop =
          state.scrollTop + (element.offsetTop - previous.offsetTop);
      }
    }

    anchorRef.current = nextAnchorEntry(content, previous, oldestMessageKey);
  });
}

/**
 * Fires `onLoadOlder` once the sentinel enters the prefetch band above the
 * viewport, gated on `escapedFromLock` (the library sets it exclusively from
 * deliberate user scroll input, never mount/hydration/resize/animation, so a
 * geometry-only gate would self-fire during load-triggered layout shifts).
 * Recreated whenever the oldest message changes: observe() always reports
 * the current intersection, so a reader parked near the top chain-loads page
 * after page without needing to move again.
 */
function useLoadOlderOnScroll({
  sentinelRef,
  scrollRef,
  hasOlder,
  isLoading,
  oldestMessageKey,
  escapedFromLock,
  onLoadOlder,
}: {
  sentinelRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  hasOlder: boolean;
  isLoading: boolean;
  oldestMessageKey: string | null;
  escapedFromLock: boolean;
  onLoadOlder: () => void;
}) {
  const observed = useLatestRef({ escapedFromLock, isLoading, onLoadOlder });

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
  }, [scrollRef, sentinelRef, hasOlder, oldestMessageKey, observed]);
}

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

  useDisableScrollAnchoring(scrollRef);
  usePrePaintBottomPin(oldestMessageKey);
  usePrependScrollAnchor({ contentRef, oldestMessageKey, isAtBottom, state });
  useLoadOlderOnScroll({
    sentinelRef,
    scrollRef,
    hasOlder,
    isLoading,
    oldestMessageKey,
    escapedFromLock,
    onLoadOlder,
  });

  // TODO(#187): when the walk exhausts (hasOlder flips false at the chat's
  // first message) this box unmounts and the transcript shifts up by its
  // 32px, uncompensated — a one-time nudge at the very top of history.
  // Reserve the box once loaded-at-least-once if it ever grates.
  if (!hasOlder) return null;

  return <LoadOlderSentinel sentinelRef={sentinelRef} isLoading={isLoading} />;
});
