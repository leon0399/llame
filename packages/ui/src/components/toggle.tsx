"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 min-w-9 px-2",
        sm: "h-8 min-w-8 px-1.5",
        lg: "h-10 min-w-10 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ToggleProps
  extends Omit<React.ComponentProps<typeof TogglePrimitive.Root>, "pressed"> {
  /** Visual style — `default` (transparent) or `outline` (bordered). */
  variant?: VariantProps<typeof toggleVariants>["variant"];
  /** Height and padding of the toggle. */
  size?: VariantProps<typeof toggleVariants>["size"];
  /** Whether the toggle is pressed (on). Pair with `onPressedChange` for a controlled toggle. */
  pressed?: boolean;
}

/**
 * Toggle is a two-state button for a single on/off setting — e.g. a
 * formatting control (bold, italic) or a view option — that flips
 * immediately on click. For a set of mutually exclusive or multi-select
 * toggles, use ToggleGroup instead.
 *
 * Vendored from the [shadcn/ui Toggle](https://ui.shadcn.com/docs/components/radix/toggle).
 *
 * @summary for a single two-state on/off control
 */
function Toggle({ className, variant, size, ...props }: ToggleProps) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
export type { ToggleProps };
