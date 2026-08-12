"use client";

import { cn } from "@workspace/ui/lib/utils";

/**
 * HoverReveal gives a sidebar row's trailing content real layout width only
 * while it is showing, so the row's text reflows around it instead of the row
 * holding a reserved gap for something invisible.
 *
 * This is a deliberate divergence from the vendored sidebar's own approach:
 * `SidebarMenuAction` is `position: absolute`, which takes no layout space, so
 * `sidebarMenuButtonVariants` compensates with a hardcoded
 * `group-has-data-[sidebar=menu-action]/menu-item:pr-8` — 32px reserved for one
 * 20px action. Any such reservation has to know how many controls there are and
 * how wide each one is. Composing in flow instead means nothing knows: put
 * whatever you like in here — one button, three, a badge, a timestamp — and the
 * text column shrinks by exactly that much. Upstream's `pr-8` rule keys off the
 * `data-sidebar=menu-action` attribute that only `SidebarMenuAction` sets, so
 * rows built this way opt out of it without overriding anything, and the
 * primitive stays untouched for callers who want the overlay.
 *
 * The width animates through a collapsing grid track rather than a `width`,
 * because `0fr → 1fr` interpolates to the child's INTRINSIC size — the reveal
 * never learns a pixel value, which is the whole point.
 *
 * Requires an ancestor carrying `group/menu-item` (any `SidebarMenuItem`), and
 * a row laid out as a flex line with the text on `min-w-0 flex-1`.
 *
 * @summary trailing row content that occupies width only while it shows
 */
export function HoverReveal({
  atRest = false,
  className,
  children,
}: {
  /**
   * Keep the content visible (and occupying width) without hover — a pinned
   * row's pin, the open row's menu.
   */
  atRest?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      data-slot="hover-reveal"
      className={cn(
        "grid transition-[grid-template-columns] duration-150 ease-out",
        // An icon-collapsed rail has room for the icon and nothing else, so
        // trailing content is gone rather than narrow — the same rule the
        // vendored `SidebarMenuAction` carries, which this replaces.
        "group-data-[collapsible=icon]:hidden",
        atRest
          ? "grid-cols-[1fr]"
          : [
              "grid-cols-[0fr]",
              "group-hover/menu-item:grid-cols-[1fr]",
              "group-focus-within/menu-item:grid-cols-[1fr]",
              "group-has-[[aria-expanded=true]]/menu-item:grid-cols-[1fr]",
              // Below `md` there is no hover to reveal anything with, so the
              // content simply stays in layout — the same reason the old
              // padding needed a mobile special case, minus the special case.
              "max-md:grid-cols-[1fr]",
            ],
        className,
      )}
    >
      {/* The track collapses to zero; this is what clips the child while it
          does — and a clipped, zero-width control is not hit-testable, so it
          needs no separate pointer-events handling. Spacing belongs on the
          child, where it collapses along with everything else.

          The clip is scoped to when it is actually needed, because it also
          cuts a focus ring: a ring is drawn outside its control's box, so a
          focused button in a clipping box loses the outline on every side.
          Content that never collapses does not need clipping at all, and
          content revealed by focus has already been expanded by the same
          `:focus-within` that draws the ring. */}
      <span
        className={cn(
          atRest
            ? "overflow-visible"
            : "overflow-hidden group-focus-within/menu-item:overflow-visible",
        )}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * SidebarRowAction is the in-flow counterpart of the vendored
 * `SidebarMenuAction`: the same icon-button affordance inside a sidebar row,
 * but laid out rather than absolutely positioned, so it belongs in a
 * `HoverReveal` and costs the row nothing while hidden. It is a thin
 * copy of its appearance, so a row keeps the exact affordance it had before.
 *
 * @summary an icon action laid out inside a sidebar row
 */
export function SidebarRowAction({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        // Byte-for-byte the vendored `SidebarMenuAction`'s appearance — same
        // 20px square, same 16px icon, same accent hover — with only its
        // positioning (`absolute top-1.5 right-1`) dropped. `relative` because
        // the oversized touch target it hangs off `after:` needs a containing
        // block that its own `absolute` used to provide.
        "relative flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
        "aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground",
        // Sits here rather than as a gap on the row: inside the reveal's
        // collapsing track this margin collapses too, whereas a row-level
        // `gap` would survive as a permanent sliver of reserved space.
        "ml-1",
        className,
      )}
      {...props}
    />
  );
}
