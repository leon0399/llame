"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Separator draws a thin dividing line between content, either between
 * stacked blocks (`horizontal`) or inline items (`vertical`).
 *
 * Vendored from the [shadcn/ui Separator](https://ui.shadcn.com/docs/components/base/separator).
 * On Base UI the separator is always semantic (`role="separator"`); the Radix
 * `decorative` prop is gone — for a purely visual rule render a plain
 * `<div aria-hidden>` instead. A `vertical` separator stretches via
 * `self-stretch`, so its parent must be a flex container.
 *
 * @summary for a thin dividing line between content
 */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
