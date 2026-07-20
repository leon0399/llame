"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

interface TabsProps
  extends Omit<
    React.ComponentProps<typeof TabsPrimitive.Root>,
    "value" | "defaultValue" | "onValueChange" | "orientation"
  > {
  /** The active tab's value (controlled). Pair with `onValueChange`. */
  value?: string;
  /** The tab value active by default (uncontrolled). */
  defaultValue?: string;
  /** Called with the next active tab value whenever the selection changes. */
  onValueChange?(value: string): void;
  /**
   * Layout axis for the tab list: `"horizontal"` (default) for a tab row, or
   * `"vertical"` for side-nav-style tabs.
   */
  orientation?: "horizontal" | "vertical";
}

/**
 * Tabs switches between peer content panels without navigating — only one
 * panel is visible at a time. Compose it with `TabsList`, `TabsTrigger`, and
 * `TabsContent`; use `orientation="vertical"` for a side-nav-style layout.
 *
 * Vendored from the [shadcn/ui Tabs](https://ui.shadcn.com/docs/components/radix/tabs).
 *
 * @summary for switching between peer content panels
 */
function Tabs({ className, orientation = "horizontal", ...props }: TabsProps) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface TabsListProps
  extends React.ComponentProps<typeof TabsPrimitive.List> {
  /**
   * Visual style: `"default"` for the boxed segmented control, or `"line"`
   * for a lighter underlined tab list that sits flush on the page surface.
   */
  variant?: VariantProps<typeof tabsListVariants>["variant"];
}

/**
 * TabsList groups a `Tabs` instance's `TabsTrigger`s.
 *
 * @summary for grouping a Tabs instance's triggers
 */
function TabsList({ className, variant = "default", ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

interface TabsTriggerProps
  extends Omit<React.ComponentProps<typeof TabsPrimitive.Trigger>, "disabled"> {
  /** Whether this tab is non-interactive and cannot be selected. */
  disabled?: boolean;
}

/**
 * TabsTrigger activates its associated `TabsContent` when selected. Render it
 * as a direct child of `TabsList`.
 *
 * @summary for the clickable control that activates a tab panel
 */
function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

/**
 * TabsContent is the panel shown while its matching `TabsTrigger` is active;
 * exactly one panel renders at a time.
 *
 * @summary for a tab's associated content panel
 */
function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
export type { TabsProps };
