"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@workspace/ui/lib/utils";

const codeBlockVariants = cva(
  "group/code-block relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg text-sm has-[>[data-slot=code-block-content]:focus-visible]:ring-3 has-[>[data-slot=code-block-content]:focus-visible]:ring-ring/50 data-[size=sm]:text-xs",
  {
    variants: {
      variant: {
        default:
          "border border-input text-foreground has-[>[data-slot=code-block-content]:focus-visible]:border-ring dark:bg-input/30",
        destructive:
          "border border-destructive/30 text-destructive dark:border-destructive/40",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function CodeBlock({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof codeBlockVariants> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="code-block"
      data-variant={variant}
      data-size={size}
      className={cn(codeBlockVariants({ variant }), className)}
      {...props}
    />
  );
}

function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2 px-3 pt-3 text-muted-foreground group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:pt-2.5 group-data-[variant=destructive]/code-block:text-destructive *:has-[>[data-slot=code-block-title]]:min-w-0",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-title"
      className={cn(
        "min-w-0 truncate font-sans text-sm font-medium text-foreground group-data-[size=sm]/code-block:text-xs group-data-[variant=destructive]/code-block:text-destructive [&_svg]:pointer-events-none [&_svg]:inline-block [&_svg]:align-middle [&_svg:not([class*='size-'])]:size-3.5 *:[svg]:me-1.5",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockContent({
  className,
  children,
  wrap = false,
  ...props
}: React.ComponentProps<"fieldset"> & {
  wrap?: boolean;
}) {
  return (
    <fieldset
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      dir="ltr"
      // A scroller must be reachable by keyboard; Safari leaves a bare
      // `overflow` node out of the tab order (see `ScrollRegion`).
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn(
        "min-h-0 min-w-0 scroll-fade-x scrollbar-thin overflow-auto px-3 py-3 text-start font-mono leading-relaxed whitespace-pre outline-none group-has-data-[slot=code-block-footer]/code-block:pb-2 group-has-data-[slot=code-block-header]/code-block:pt-2 group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:py-2.5 group-data-[size=sm]/code-block:group-has-data-[slot=code-block-header]/code-block:pt-1.5 data-wrap:scroll-fade-y data-wrap:wrap-break-word data-wrap:whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      <code
        data-slot="code-block-code"
        className="grid min-h-lh min-w-max content-start in-data-wrap:min-w-0"
      >
        {children}
      </code>
    </fieldset>
  );
}

export { CodeBlock, CodeBlockHeader, CodeBlockTitle, CodeBlockContent };
