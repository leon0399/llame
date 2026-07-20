"use client";

import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Label renders an accessible label associated with a form control. Pair it
 * with `htmlFor`/`id` so clicking the label text focuses or toggles the
 * control.
 *
 * Vendored from the [shadcn/ui Label](https://ui.shadcn.com/docs/components/radix/label).
 *
 * @summary for labelling a form control accessibly
 */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
