"use client";

import { useEffect, useRef } from "react";

import { cn } from "@workspace/ui/lib/utils";

// Overflow language for sidebar rows (DESIGN.md §3, "Overflow"): a FADE means
// the cut content is reachable right here — hovering the row scrolls the title
// to its end — while an ELLIPSIS means this view never intends to show the
// rest (a chat's message excerpt belongs to the conversation, not to the row).
// This component owns the fade half; ellipsis stays a plain `truncate` at the
// call site, sized by the row's own hover padding so it never lands under an
// action button.
//
// Hover and focus are read from the ROW (`group/menu-item`, set by
// `SidebarMenuItem`), so this only works inside a sidebar menu row — the
// target is the whole row, not the text.

/**
 * One motion for everything the hover reveals: the actions fade and slide over
 * the same 150ms the row's padding takes to open, so the text's edge, the pin
 * and the kebab all move together instead of at three different speeds. (The
 * primitive only transitions `transform`, which pops the opacity.)
 */
export const ROW_ACTION_MOTION =
  "transition-[transform,opacity] duration-150 ease-out";

/** px/s the title scrolls at on hover — slow enough to read as it passes. */
const SCROLL_SPEED = 60;
/** A pathological title must not crawl for 20s; ms bounds on the scroll. */
const SCROLL_MS = { MIN: 150, MAX: 2500 };
/** Held back this long so a sweep across the list does not set rows moving. */
const SCROLL_DELAY = 300;

/**
 * Right padding a sidebar row holds for the actions it shows WITHOUT hover.
 * Two `w-5` actions sit 4–48px from the row's right edge and one sits 4–24px;
 * `pr-13` and `pr-7` clear those with 4px to spare, and `pr-2` is the row's own
 * resting padding. The classes carry the primitive's `group-has-…` prefix so
 * `cn` merges away its flat `pr-8` instead of losing to it on specificity.
 *
 * Below `md` none of this applies: `SidebarMenuAction`'s `showOnHover` hides
 * only through `md:opacity-0`, so both actions are permanently visible there
 * (the chat list renders inside the mobile sheet) and the row must hold their
 * full width the way it does when hovered.
 *
 * @summary the resting action padding for a sidebar row
 */
export function rowRestPadding(isPinned: boolean, isActive: boolean): string {
  const mobile = "max-md:pr-13!";
  if (isPinned && isActive) {
    return `group-has-data-[sidebar=menu-action]/menu-item:pr-13 ${mobile}`;
  }
  if (isPinned || isActive) {
    return `group-has-data-[sidebar=menu-action]/menu-item:pr-7 ${mobile}`;
  }
  return `group-has-data-[sidebar=menu-action]/menu-item:pr-2 ${mobile}`;
}

/**
 * The width a row opens up once it is showing both actions. `!` because the
 * resting rule above shares this one's specificity, so source order would
 * otherwise decide which wins.
 */
export const ROW_HOVER_PADDING =
  "group-hover/menu-item:pr-13! group-focus-within/menu-item:pr-13! group-has-[[aria-expanded=true]]/menu-item:pr-13!";

/**
 * For the pin of a pinned row whose kebab is hidden: sit at the row's edge
 * rather than hold the kebab's slot empty, and give the slot back when hover
 * reveals it. `md:`-only — below that the kebab is always visible, so the slot
 * is never free.
 */
export const ROW_PIN_TAKES_KEBAB_SLOT =
  "md:translate-x-6 md:group-hover/menu-item:translate-x-0 md:group-focus-within/menu-item:translate-x-0 md:group-has-[[aria-expanded=true]]/menu-item:translate-x-0";

/**
 * SidebarRowTitle renders a row title that fades out (never ellipses) when it
 * is too long, and scrolls to its end — marquee-style, once, no wrap, no loop —
 * while the row is hovered or focused, reversing faster on leave. The trailing
 * fade shrinks away as the tail arrives and a leading one grows in its place,
 * so the fade always marks the side that still has text behind it. Use it for
 * titles whose tail is worth reading; use a plain `truncate` for text this view
 * has no intent to reveal.
 *
 * @summary a row title that fades when clipped and scrolls to its end on hover
 */
export function SidebarRowTitle({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const clipRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  // Everything is written straight to the DOM rather than through state: the
  // chat list renders every row it has, and hovering one must not re-render
  // any of them. An observer rather than a one-shot read because the width
  // that matters arrives late and repeatedly — stylesheets and web fonts land
  // after mount, and the row's own hover padding animates the box mid-gesture.
  useEffect(() => {
    const clip = clipRef.current;
    const node = textRef.current;
    // No ResizeObserver (jsdom) means no layout to measure either; the title
    // renders plain, which is the same thing the guard below would produce.
    if (!clip || !node || typeof ResizeObserver === "undefined") return;

    const row = clip.closest("[data-sidebar=menu-item]");
    if (process.env.NODE_ENV !== "production" && row === null) {
      console.warn(
        "SidebarRowTitle must render inside a SidebarMenuItem — hover and focus come from that row, so the fade and scroll stay inert here.",
      );
    }

    // A resize storm (a window resize reflows every row) is mostly rows whose
    // answer did not change, and each write here can invalidate style on an
    // element CSS selectors key off — so only write what actually moved.
    let last: { clipped: boolean; shift: number } | null = null;

    const sync = () => {
      const shift = Math.max(0, node.scrollWidth - clip.clientWidth);
      const clipped = shift > 0;

      if (last === null || last.clipped !== clipped) {
        clip.dataset.clipped = String(clipped);
        node.dataset.clipped = String(clipped);
      }
      if (last === null || last.shift !== shift) {
        writeScroll(clip, shift);
      }
      last = { clipped, shift };

      // The tooltip carries the RESTING truth — does this title have a tail the
      // row hides? — so it is only written while the row is at rest. Reading it
      // under hover is what makes a title that merely sits behind the buttons
      // claim a tail it does not have. It is that tail's only route for
      // pointerless and reduced-motion users.
      if (!row?.matches(":hover, :focus-within")) {
        const title = clipped ? text : "";
        if (clip.title !== title) clip.title = title;
      }
    };

    const observer = new ResizeObserver(sync);
    observer.observe(clip);
    // The text's own width moves when the appearance system swaps the font.
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span
      ref={clipRef}
      className={cn(
        "block min-w-0 overflow-hidden text-clip whitespace-nowrap",
        // Both fades collapse to 0 by default (@property initial value), which
        // leaves this gradient fully opaque — so it costs an unclipped title
        // nothing.
        "[mask-image:linear-gradient(to_right,transparent_0,#000_var(--marquee-fade-l),#000_calc(100%_-_var(--marquee-fade-r)),transparent_100%)]",
        // Anything currently cut off gets the trailing fade — including a
        // title that only the hover padding clips. The width comes from the
        // same token the `marquee-tail` keyframe starts from, so the animation
        // picks up exactly where this leaves off instead of popping.
        "data-[clipped=true]:[--marquee-fade-r:var(--marquee-fade-max)]",
        // The fades bracket the travel rather than interpolate across it: the
        // leading one arrives as the title starts moving, and the trailing one
        // holds until the tail has actually landed (`--marquee-end-ms` is the
        // delay plus the scroll's own duration) — see the `marquee-tail`
        // keyframes for why that half is an animation and not a transition.
        "[transition:--marquee-fade-l_150ms_ease-out,--marquee-fade-r_150ms_ease-out]",
        "group-hover/menu-item:data-[clipped=true]:[--marquee-fade-l:var(--marquee-fade-max)] group-hover/menu-item:[transition:--marquee-fade-l_150ms_ease-out_var(--marquee-delay)]",
        "group-focus-within/menu-item:data-[clipped=true]:[--marquee-fade-l:var(--marquee-fade-max)] group-focus-within/menu-item:[transition:--marquee-fade-l_150ms_ease-out_var(--marquee-delay)]",
        "group-hover/menu-item:data-[clipped=true]:[animation:marquee-tail_150ms_ease-out_var(--marquee-end-ms)_both]",
        "group-focus-within/menu-item:data-[clipped=true]:[animation:marquee-tail_150ms_ease-out_var(--marquee-end-ms)_both]",
        // Nothing scrolls under reduced motion, so the trailing fade must stay
        // put and the leading one never arrives — otherwise the fade retreats
        // on hover and claims the title ends there while it is still clipped.
        "motion-reduce:animate-none! motion-reduce:[--marquee-fade-l:0px]!",
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
        )}
      >
        {text}
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
