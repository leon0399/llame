"use client";

import * as React from "react";
import { Separator as SeparatorPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

interface SeparatorProps
  extends Omit<
    React.ComponentProps<typeof SeparatorPrimitive.Root>,
    "orientation" | "decorative"
  > {
  /**
   * Layout axis: `"horizontal"` (default) for a full-width line between
   * stacked blocks, or `"vertical"` for a full-height line between inline
   * items (the parent needs an explicit or content-derived height).
   */
  orientation?: "horizontal" | "vertical";
  /**
   * Whether the separator is purely visual with no semantic meaning for
   * assistive tech (renders `role="none"`). Defaults to `true`; set `false`
   * when it marks a real thematic break in the content.
   */
  decorative?: boolean;
}

/**
 * Separator draws a thin dividing line between content, either between
 * stacked blocks (`horizontal`) or inline items (`vertical`).
 *
 * Vendored from the [shadcn/ui Separator](https://ui.shadcn.com/docs/components/radix/separator).
 *
 * @summary for a thin dividing line between content
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
