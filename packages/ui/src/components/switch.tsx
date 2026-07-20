"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

interface SwitchProps
  extends Omit<
    React.ComponentProps<typeof SwitchPrimitive.Root>,
    "checked" | "defaultChecked" | "onCheckedChange" | "disabled"
  > {
  /** Visual size of the switch and its thumb. */
  size?: "sm" | "default";
  /** Whether the switch is on (controlled). Pair with `onCheckedChange`. */
  checked?: boolean;
  /** Whether the switch is on by default (uncontrolled). */
  defaultChecked?: boolean;
  /** Called with the next checked state whenever the switch is toggled. */
  onCheckedChange?(checked: boolean): void;
  /** Whether the switch is non-interactive. */
  disabled?: boolean;
}

/**
 * Switch is a two-state control for a single on/off setting that applies
 * immediately on toggle.
 *
 * Vendored from the [shadcn/ui Switch](https://ui.shadcn.com/docs/components/radix/switch).
 *
 * @summary for a single immediate on/off setting
 */
function Switch({ className, size = "default", ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
export type { SwitchProps };
