"use client";

import * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

interface HoverCardProps
  extends React.ComponentProps<typeof HoverCardPrimitive.Root> {
  /**
   * Milliseconds the pointer must rest on the trigger before the card opens.
   * Radix upstream defaults to 700ms.
   */
  openDelay?: number;
  /**
   * Milliseconds after the pointer leaves the trigger/content before the
   * card closes. Radix upstream defaults to 300ms.
   */
  closeDelay?: number;
}

/**
 * HoverCard previews content behind a link or trigger for sighted users on
 * pointer hover, without requiring a click or navigation. Compose it with
 * {@link HoverCardTrigger} and {@link HoverCardContent}.
 *
 * Vendored from the [shadcn/ui Hover Card](https://ui.shadcn.com/docs/components/radix/hover-card).
 *
 * @summary for pointer-hover previews of linked content
 */
function HoverCard({ ...props }: HoverCardProps) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

/**
 * HoverCardTrigger is the element that opens the card on pointer hover. Pass
 * `asChild` to merge onto an existing element (e.g. a `Button` with
 * `variant="link"`) instead of rendering a new one.
 *
 * @summary for the element that opens the hover card
 */
function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  );
}

interface HoverCardContentProps
  extends React.ComponentProps<typeof HoverCardPrimitive.Content> {
  /**
   * Preferred side of the trigger to render the card on; Radix flips to the
   * opposite side automatically when there isn't room.
   */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment of the card relative to the trigger. */
  align?: "start" | "center" | "end";
}

/**
 * HoverCardContent is the popup shown while the trigger is hovered. Renders
 * through a portal.
 *
 * @summary for the hover card's popup content
 */
function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: HoverCardContentProps) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-64 origin-(--radix-hover-card-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
