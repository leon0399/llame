import { Loader2Icon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Spinner is a small animated loading indicator, typically placed inline
 * beside a label or nested inside a Button/Badge to signal an in-progress or
 * disabled state. It has no props beyond `className` — size and color are
 * set with utility classes (e.g. `size-*`).
 *
 * Vendored from the [shadcn/ui Spinner](https://ui.shadcn.com/docs/components/radix/spinner).
 *
 * @summary for a small animated loading indicator
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
