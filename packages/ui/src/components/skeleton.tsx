import { cn } from "@workspace/ui/lib/utils";

/**
 * Skeleton renders a pulsing placeholder shape in place of content that is
 * still loading, so the layout doesn't jump once the real content arrives.
 *
 * Vendored from the [shadcn/ui Skeleton](https://ui.shadcn.com/docs/components/base/skeleton).
 *
 * @summary for a pulsing loading placeholder shaped like the content it stands in for
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
