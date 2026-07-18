"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

interface TooltipProviderProps
  extends React.ComponentProps<typeof TooltipPrimitive.Provider> {
  /**
   * Milliseconds the pointer must rest on a trigger before its tooltip
   * opens. Radix upstream defaults to 700ms; this fork opens instantly.
   */
  delayDuration?: number;
}

/**
 * TooltipProvider configures shared hover behavior — most notably
 * `delayDuration` — for every {@link Tooltip} beneath it. The shadcn docs
 * call for wrapping it once near the app root; mirror that with a decorator
 * in stories.
 *
 * @summary shared hover-delay context for nested tooltips
 */
function TooltipProvider({
  delayDuration = 0,
  ...props
}: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/**
 * Tooltip shows a short hint for its trigger on hover or keyboard focus.
 * Compose it with {@link TooltipTrigger} and {@link TooltipContent}, inside a
 * {@link TooltipProvider} ancestor.
 *
 * Vendored from the [shadcn/ui Tooltip](https://ui.shadcn.com/docs/components/radix/tooltip).
 *
 * @summary for a short hint on hover or keyboard focus
 */
function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

/**
 * TooltipTrigger is the element that opens the tooltip on hover or focus.
 * Pass `asChild` to merge onto an existing focusable element (e.g. a
 * `Button` or a disabled control's wrapping `span`) instead of adding a new
 * one.
 *
 * @summary for the element that opens the tooltip
 */
function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

interface TooltipContentProps
  extends React.ComponentProps<typeof TooltipPrimitive.Content> {
  /**
   * Preferred side of the trigger to render the tooltip on; Radix flips to
   * the opposite side automatically when there isn't room.
   */
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * TooltipContent is the popup shown while the trigger is hovered or
 * focused. Renders through a portal with a pointing arrow.
 *
 * @summary for the tooltip's popup content
 */
function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
