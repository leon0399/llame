"use client";

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "@workspace/ui/lib/utils";

/**
 * HoverCard previews content behind a link or trigger for sighted users on
 * pointer hover, without requiring a click or navigation. Compose it with
 * {@link HoverCardTrigger} and {@link HoverCardContent}. In Base UI the open
 * (`delay`) and `closeDelay` timings are configured on the trigger, not here.
 *
 * Vendored from the [shadcn/ui Hover Card](https://ui.shadcn.com/docs/components/base/hover-card).
 *
 * @summary for pointer-hover previews of linked content
 */
function HoverCard({ ...props }: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />;
}

/**
 * HoverCardTrigger is the element that opens the card on pointer hover. Pass
 * `render` to merge onto an existing element (e.g. a `Button` with
 * `variant="link"`) instead of rendering a new one. Set `delay`/`closeDelay`
 * (ms) here to tune the open/close timing.
 *
 * @summary for the element that opens the hover card
 */
function HoverCardTrigger({ ...props }: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  );
}

/**
 * HoverCardContent is the popup shown while the trigger is hovered. Renders
 * through a portal.
 *
 * @summary for the hover card's popup content
 */
function HoverCardContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 4,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "z-50 w-64 origin-(--transform-origin) rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
