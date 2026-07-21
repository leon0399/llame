import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Card groups related content and actions in a bordered, elevated container.
 * Compose it with `CardHeader` (title/description/action), `CardContent`,
 * and `CardFooter`. Section spacing is driven by the `--card-spacing` CSS
 * variable: an image as the Card's first child renders flush to the top edge
 * (its corners rounded to match the card), and content can break out
 * edge-to-edge with negative margins (`-mx-(--card-spacing)`).
 *
 * Vendored from the [shadcn/ui Card](https://ui.shadcn.com/docs/components/base/card).
 *
 * @summary for grouping related content and actions in a bordered container
 */
function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & {
  /**
   * Spacing density. `sm` tightens `--card-spacing` for compact cards; the
   * default preserves the standard spacing.
   */
  size?: "default" | "sm";
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className,
      )}
      {...props}
    />
  );
}

/** Header row for a Card's title, description, and optional `CardAction`. */
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

/** The Card's title. */
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        // Upstream base-nova adds `cn-font-heading` here for a heading
        // font-family; we run a single sans family (no heading font defined),
        // so it's dropped as a dangling no-op rather than vendored verbatim.
        "text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

/** Helper text under the `CardTitle`. */
function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Places content (e.g. a button or badge) in the top-right of `CardHeader`. */
function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

/** The Card's main body content. */
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  );
}

/** Actions and secondary content at the bottom of a Card. */
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
