"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Drawer is a panel that rises from the bottom edge of a phone screen and
 * closes by swiping it down, for content that needs the full screen width
 * there. Compose `DrawerContent` with `DrawerTitle`; on wider screens use a
 * Sheet or keep the content in place instead.
 *
 * Built on [Base UI Drawer](https://base-ui.com/react/components/drawer).
 *
 * @summary for a bottom panel that a phone user swipes away
 */
function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

/** An element that closes the drawer when activated; pass `render` to merge onto a custom control. */
function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

/** The drawer's surface: portaled, over a dimmed page, at most 85% of the
 *  screen's height, with a grab handle on top. It follows the finger while
 *  swiped and slides off when released past the threshold. */
function DrawerContent({
  className,
  children,
  ...props
}: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Backdrop
        data-slot="drawer-overlay"
        className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs"
      />
      <DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex items-end">
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "flex max-h-[85dvh] w-full translate-y-(--drawer-swipe-movement-y) flex-col rounded-t-xl border-t bg-popover text-sm text-popover-foreground shadow-lg outline-none transition-transform duration-300 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full data-swiping:duration-0",
            className,
          )}
          {...props}
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30"
          />
          <DrawerPrimitive.Content className="flex min-h-0 flex-1 flex-col">
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

/** The drawer's accessible name. */
function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

export { Drawer, DrawerClose, DrawerContent, DrawerTitle };
