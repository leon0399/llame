import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@workspace/ui/lib/utils";

const markerVariants = cva(
  "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground",
  {
    variants: {
      variant: {
        default: "",
        separator:
          "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border",
        border: "border-b border-border pb-2",
      },
    },
  },
);

interface MarkerProps extends useRender.ComponentProps<"div"> {
  /**
   * Visual treatment: `default` (plain row), `separator` (horizontal rules
   * flanking centered content, e.g. a chat-transcript divider), or `border`
   * (bottom border, e.g. a section boundary).
   */
  variant?: VariantProps<typeof markerVariants>["variant"];
}

/**
 * Marker is a small inline row for a status line, divider, or boundary
 * marker — e.g. a "model changed" separator in a chat transcript. Compose it
 * with `MarkerIcon` and `MarkerContent` for an icon-plus-text row, and
 * choose a `variant` for the surrounding treatment. Pass `render` (e.g.
 * `render={<a />}`) to render marker styling onto an existing element.
 *
 * @summary for status lines, dividers, and boundary markers
 */
function Marker({
  className,
  variant = "default",
  render,
  ...props
}: MarkerProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(markerVariants({ variant, className })),
      },
      props,
    ),
    render,
    // useRender emits each state key as a `data-*` attribute
    // (`data-slot="marker"`, `data-variant="…"`), matching Badge.
    state: {
      slot: "marker",
      variant,
    },
  });
}

/**
 * MarkerIcon wraps a leading/trailing icon within a `Marker` row; it is
 * `aria-hidden` since the icon is decorative alongside `MarkerContent`'s
 * text.
 *
 * @summary decorative icon slot within a Marker
 */
function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * MarkerContent wraps the text/label content of a `Marker` row.
 *
 * @summary text content of a Marker row
 */
function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        "min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Marker, MarkerIcon, MarkerContent, markerVariants };
