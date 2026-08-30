"use client";

import { useEffect, useRef, type RefObject } from "react";

import { cn } from "@workspace/ui/lib/utils";

import { useTypewriter } from "./use-typewriter";

// Overflow language for sidebar rows (DESIGN.md §3, "Overflow"): a FADE means
// the cut content is reachable right here — hovering the row scrolls the title
// to its end — while an ELLIPSIS means this view never intends to show the
// rest (a chat's message excerpt belongs to the conversation, not to the row).
// This component owns the fade half; ellipsis stays a plain `truncate` at the
// call site, sized by whatever the row's trailing actions occupy (they are in
// flow — see HoverReveal) so it never lands under a button.
//
// Hover and focus are read from the ROW (`group/menu-item`, set by
// `SidebarMenuItem`), so this only works inside a sidebar menu row — the
// target is the whole row, not the text.

/** px/s the title scrolls at on hover — slow enough to read as it passes. */
const SCROLL_SPEED = 60;
/** A pathological title must not crawl for 20s; ms bounds on the scroll. */
const SCROLL_MS = { MIN: 150, MAX: 2500 };
/** Held back this long so a sweep across the list does not set rows moving. */
const SCROLL_DELAY = 300;

type OverflowState = { clipped: boolean; shift: number };

function syncTitleOverflow(params: {
  clip: HTMLElement;
  node: HTMLElement;
  text: string;
  row: Element | null;
  last: OverflowState | null;
}) {
  const { clip, node, text, row, last } = params;
  const shift = Math.max(0, node.scrollWidth - clip.clientWidth);
  const clipped = shift > 0;

  if (last === null || last.clipped !== clipped) {
    clip.dataset.clipped = String(clipped);
    node.dataset.clipped = String(clipped);
  }
  if (last === null || last.shift !== shift) {
    writeScroll(clip, shift);
  }

  // The tooltip carries the RESTING truth — does this title have a tail the
  // row hides? — so it is only written while the row is at rest. Reading it
  // under hover is what makes a title that merely sits behind the buttons
  // claim a tail it does not have. It is that tail's only route for
  // pointerless and reduced-motion users.
  if (!row?.matches(":hover, :focus-within")) {
    const title = clipped ? text : "";
    if (clip.title !== title) clip.title = title;
  }

  return { clipped, shift };
}

// Everything is written straight to the DOM rather than through state: the
// chat list renders every row it has, and hovering one must not re-render
// any of them. An observer rather than a one-shot read because the width
// that matters arrives late and repeatedly — stylesheets and web fonts land
// after mount, the trailing actions take their width mid-gesture, and a
// retyping title changes the text's own width on every character.
function useTitleOverflowSync(
  clipRef: RefObject<HTMLSpanElement | null>,
  textRef: RefObject<HTMLSpanElement | null>,
  text: string,
): void {
  useEffect(() => {
    const clip = clipRef.current;
    const node = textRef.current;
    // No ResizeObserver (jsdom) means no layout to measure either; the title
    // renders plain, which is the same thing the guard below would produce.
    if (!clip || !node || !("ResizeObserver" in globalThis)) return;

    const row = clip.closest("[data-sidebar=menu-item]");
    if (process.env.NODE_ENV !== "production" && row === null) {
      console.warn(
        "SidebarRowTitle must render inside a SidebarMenuItem — hover and focus come from that row, so the fade and scroll stay inert here.",
      );
    }

    // A resize storm (a window resize reflows every row) is mostly rows whose
    // answer did not change, and each write here can invalidate style on an
    // element CSS selectors key off — so only write what actually moved.
    let last: OverflowState | null = null;
    const sync = () => {
      last = syncTitleOverflow({ clip, node, text, row, last });
    };

    const observer = new ResizeObserver(sync);
    observer.observe(clip);
    // The text's own width moves when the appearance system swaps the font.
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, clipRef, textRef]);
}

type SidebarRowTitleProps = {
  text: string;
  /**
   * Retype the title when it changes, rather than swapping it — see
   * `useTypewriter`. The measurement and the native tooltip keep using the
   * final text, so a half-typed name never claims a tail it does not have.
   */
  animateChanges?: boolean;
  /**
   * Sweep the text while it stands for work in progress — a chat that has no
   * name yet because a run is still producing one.
   */
  shimmer?: boolean;
  className?: string;
};

/**
 * SidebarRowTitle renders a row title that fades out (never ellipses) when it
 * is too long, and scrolls to its end — marquee-style, once, no wrap, no loop —
 * while the row is hovered or focused, reversing faster on leave. The fade sits
 * on the trailing edge only and holds until the tail lands, marking the side
 * that still has text behind it. Use it for titles whose tail is worth reading;
 * use a plain `truncate` for text this view has no intent to reveal.
 *
 * @summary a row title that fades when clipped and scrolls to its end on hover
 */
export function SidebarRowTitle({
  text,
  animateChanges = false,
  shimmer = false,
  className,
}: SidebarRowTitleProps) {
  const clipRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const display = useTypewriter(text, { enabled: animateChanges });

  useTitleOverflowSync(clipRef, textRef, text);

  return (
    <span
      ref={clipRef}
      className={cn(
        "block min-w-0 overflow-hidden text-clip whitespace-nowrap",
        // The fade collapses to 0 by default (@property initial value), which
        // leaves this gradient fully opaque — so it costs an unclipped title
        // nothing.
        //
        // Trailing edge only. A leading fade would say "there is more this
        // way" on a side nothing can reveal — leaving the row abandons the
        // gesture, it does not scroll back — and at this type size it renders
        // as two or three half-dissolved glyphs beside the row icon. The clean
        // clip against the container edge reads as clipped content instead.
        "[mask-image:linear-gradient(to_right,#000_calc(100%_-_var(--marquee-fade-r)),transparent_100%)]",
        // Anything currently cut off gets the fade — including a title that
        // only the revealed actions clip. The width comes from the same token
        // the `marquee-tail` keyframe starts from, so the animation picks up
        // exactly where this leaves off instead of popping.
        "data-[clipped=true]:[--marquee-fade-r:var(--marquee-fade-max)]",
        // The fade holds for the whole travel and leaves only once the tail
        // has landed (`--marquee-end-ms` is the delay plus the scroll's own
        // duration) — see the `marquee-tail` keyframes for why that is an
        // animation and not a transition. This transition covers the return.
        "[transition:--marquee-fade-r_150ms_ease-out]",
        "group-hover/menu-item:data-[clipped=true]:[animation:marquee-tail_150ms_ease-out_var(--marquee-end-ms)_both]",
        "group-focus-within/menu-item:data-[clipped=true]:[animation:marquee-tail_150ms_ease-out_var(--marquee-end-ms)_both]",
        // Nothing scrolls under reduced motion, so the fade must stay put —
        // otherwise it retreats on hover and claims the title ends there while
        // it is still clipped.
        "motion-reduce:animate-none!",
        className,
      )}
    >
      <span
        ref={textRef}
        className={cn(
          // Leaving reverses at a flat 200ms — faster than the read-speed
          // scroll — while `--marquee-delay` holds it back on the way in.
          "inline-block transition-transform duration-200 ease-out",
          "group-hover/menu-item:data-[clipped=true]:translate-x-(--marquee-x) group-hover/menu-item:delay-(--marquee-delay) group-hover/menu-item:duration-(--marquee-ms) group-hover/menu-item:ease-linear",
          "group-focus-within/menu-item:data-[clipped=true]:translate-x-(--marquee-x) group-focus-within/menu-item:delay-(--marquee-delay) group-focus-within/menu-item:duration-(--marquee-ms) group-focus-within/menu-item:ease-linear",
          // Scrolling text is motion for its own sake to anyone who opted out;
          // the fade and the native tooltip still carry the meaning.
          "motion-reduce:translate-x-0! motion-reduce:transition-none",
          // A name still being generated reads as in-progress rather than as
          // a real title. Pure CSS (shadcn's `shimmer`, already imported in
          // globals.css) so an unvirtualized list pays nothing per row for it.
          shimmer && "shimmer motion-reduce:animate-none",
        )}
      >
        {display}
      </span>
    </span>
  );
}

/** How far the title still has to travel, and how long that takes to read. */
function writeScroll(clip: HTMLElement, shift: number) {
  const duration = Math.round(
    Math.min(
      SCROLL_MS.MAX,
      Math.max(SCROLL_MS.MIN, (shift / SCROLL_SPEED) * 1000),
    ),
  );
  // Negative, so the utilities above need no negated arbitrary value.
  clip.style.setProperty("--marquee-x", `${-Math.round(shift)}px`);
  clip.style.setProperty("--marquee-ms", `${duration}ms`);
  // Published rather than hardcoded in the classes, so the scroll's delay and
  // the fades' can only ever be the same number.
  clip.style.setProperty("--marquee-delay", `${SCROLL_DELAY}ms`);
  // When the tail lands — the moment the trailing fade has nothing left to
  // hide, and may go.
  clip.style.setProperty("--marquee-end-ms", `${SCROLL_DELAY + duration}ms`);
}
