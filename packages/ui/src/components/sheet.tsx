"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";

/**
 * Sheet is a dialog anchored to an edge of the viewport instead of centered,
 * for supplementary content or forms that complement the main view without
 * fully replacing it. Compose with `SheetTrigger` and `SheetContent`; pick
 * the anchored edge with `SheetContent`'s `side` prop.
 *
 * Vendored from the [shadcn/ui Sheet](https://ui.shadcn.com/docs/components/base/sheet).
 *
 * @summary for edge-anchored content that complements the main view
 */
function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

/** The element that opens the sheet on click; pass `asChild` (a compat alias for Base UI's `render`) to merge onto an existing element instead of adding a new one. */
function SheetTrigger({
  asChild = false,
  render,
  children,
  ...props
}: SheetPrimitive.Trigger.Props & { asChild?: boolean }) {
  const resolvedRender =
    asChild && React.isValidElement(children)
      ? (children as React.ReactElement)
      : render;
  return (
    <SheetPrimitive.Trigger
      data-slot="sheet-trigger"
      render={resolvedRender}
      {...props}
    >
      {asChild ? undefined : children}
    </SheetPrimitive.Trigger>
  );
}

/** An element that closes the sheet when activated; pass `asChild` (a compat alias for `render`) to merge onto a custom close control (e.g. a footer button). */
function SheetClose({
  asChild = false,
  render,
  children,
  ...props
}: SheetPrimitive.Close.Props & { asChild?: boolean }) {
  const resolvedRender =
    asChild && React.isValidElement(children)
      ? (children as React.ReactElement)
      : render;
  return (
    <SheetPrimitive.Close
      data-slot="sheet-close"
      render={resolvedRender}
      {...props}
    >
      {asChild ? undefined : children}
    </SheetPrimitive.Close>
  );
}

/** Renders `SheetOverlay` and `SheetContent` into a portal; used internally by `SheetContent`, most consumers won't render this directly. */
function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

/** Dims the page behind the sheet; renders automatically inside `SheetContent`. */
function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
}

interface SheetContentProps extends SheetPrimitive.Popup.Props {
  /** Which edge of the viewport the sheet slides in from. */
  side?: "top" | "right" | "bottom" | "left";
  /** Whether to render the default close button (X icon) in the top-right corner. */
  showCloseButton?: boolean;
}

/** The sheet's rendered surface — the anchored panel most consumers configure with `SheetHeader`/`SheetFooter`. Portals itself and dims the background via `SheetOverlay`. */
function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

/** Groups `SheetTitle` and `SheetDescription` at the top of the sheet. */
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  );
}

/** Groups the sheet's actions, pinned to the bottom via `mt-auto`. */
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

/** The sheet's accessible name — required for screen readers; rendered as a heading-styled element. */
function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

/** The sheet's accessible description, announced alongside the title; optional but recommended when the title alone doesn't convey the sheet's purpose. */
function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
