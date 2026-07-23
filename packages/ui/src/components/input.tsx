import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Input is a single-line text field for forms and free-text entry. For
 * multi-line content use `Textarea` instead; pair with `Field`/`FieldLabel`
 * for a labelled control.
 *
 * Vendored from the [shadcn/ui Input](https://ui.shadcn.com/docs/components/base/input).
 *
 * @summary for single-line text entry
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
