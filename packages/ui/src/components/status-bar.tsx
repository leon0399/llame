import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@workspace/ui/lib/utils";

/** One line of `text-xs` plus the hairline above it. */
const STATUS_BAR_HEIGHT = "1.5rem";

/**
 * StatusBarFrame stacks the app shell above a `StatusBar` across the full
 * window width, the way an editor's status bar sits under its side bars.
 * Docked sidebars are fixed to the viewport, so the frame hands them its bar
 * height through `--sidebar-bottom` and they stop above the bar instead of
 * running under it. Put the shell's `SidebarProvider` and the bar inside it.
 *
 * @summary for an app shell with a full-width bottom status bar
 */
function StatusBarFrame({
  className,
  style,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="status-bar-frame"
      className={cn("flex h-svh flex-col", className)}
      style={
        // SAFETY: `--sidebar-bottom` is a CSS custom property; a valid
        // inline style key at runtime that CSSProperties's type doesn't
        // model, so this asserts past that gap only.
        {
          "--sidebar-bottom": STATUS_BAR_HEIGHT,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

/**
 * StatusBar is the window-wide strip of compact status items under the app:
 * one `StatusBarGroup` at the start and one at the end. Desktop only — on a
 * phone the space goes to content, and the frame's sidebars are sheets there.
 *
 * @summary for the bottom strip of at-a-glance status
 */
function StatusBar({ className, ...props }: React.ComponentProps<"footer">) {
  return (
    <footer
      data-slot="status-bar"
      className={cn(
        "hidden h-(--sidebar-bottom) shrink-0 items-center justify-between gap-4 border-t bg-sidebar px-2 text-xs text-sidebar-foreground md:flex",
        className,
      )}
      {...props}
    />
  );
}

/** A run of `StatusBarItem`s at one end of the bar. */
function StatusBarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="status-bar-group"
      className={cn("flex min-w-0 items-center gap-1", className)}
      {...props}
    />
  );
}

/**
 * One status entry: icon and text on a single line. A `span` by default;
 * pass `render` (e.g. `render={<Link href="…" />}`) for an item that opens
 * something, which then takes a hover fill.
 *
 * @summary for one item in the status bar
 */
function StatusBarItem({
  className,
  render,
  ...props
}: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          "flex h-5 min-w-0 items-center gap-1.5 rounded-md px-1.5 whitespace-nowrap ring-sidebar-ring outline-hidden focus-visible:ring-2 [a&]:hover:bg-sidebar-accent [button&]:hover:bg-sidebar-accent [&>svg]:size-3.5 [&>svg]:shrink-0",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "status-bar-item" },
  });
}

export { StatusBar, StatusBarFrame, StatusBarGroup, StatusBarItem };
