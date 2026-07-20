"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Popover shows rich, interactive content anchored to a trigger element,
 * opened by click and dismissed by clicking outside or pressing Escape.
 * Compose it with {@link PopoverTrigger} and {@link PopoverContent} — its
 * click-triggered, focusable content makes it suitable for inline forms,
 * unlike a hover-triggered card.
 *
 * Vendored from the [shadcn/ui Popover](https://ui.shadcn.com/docs/components/radix/popover).
 *
 * @summary for click-triggered rich content anchored to an element
 */
function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/**
 * PopoverTrigger is the element that opens the popover on click. Pass
 * `asChild` to merge onto an existing element (e.g. a `Button`) instead of
 * rendering a new one.
 *
 * @summary for the element that opens the popover
 */
function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

interface PopoverContentProps
  extends React.ComponentProps<typeof PopoverPrimitive.Content> {
  /**
   * Preferred side of the trigger to render the content on; Radix flips to
   * the opposite side automatically when there isn't room. Radix upstream
   * defaults to `"bottom"`.
   */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment of the content relative to the trigger. */
  align?: "start" | "center" | "end";
  /** Pixel offset from the trigger along `side`. */
  sideOffset?: number;
}

/**
 * PopoverContent is the popup shown while the popover is open. Renders
 * through a portal.
 *
 * @summary for the popover's popup content
 */
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/**
 * PopoverAnchor repositions the popover relative to an element other than
 * {@link PopoverTrigger}, without changing what opens or closes it.
 *
 * @summary for anchoring the popover to an element other than its trigger
 */
function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * PopoverHeader groups a {@link PopoverTitle} and {@link PopoverDescription}
 * with consistent spacing at the top of {@link PopoverContent}.
 *
 * @summary for grouping the popover's title and description
 */
function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  );
}

/**
 * PopoverTitle is the popover's heading text.
 *
 * @summary for the popover's heading text
 */
function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  );
}

/**
 * PopoverDescription is supporting text rendered below {@link PopoverTitle}.
 *
 * @summary for supporting text below the popover's title
 */
function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
};
