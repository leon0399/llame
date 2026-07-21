"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";

/**
 * Dialog is a window overlaid on the primary window (or another dialog),
 * rendering the content underneath inert until dismissed. Use for focused
 * tasks — forms, confirmations, or supplementary detail — that should
 * interrupt the current view. Compose with `DialogTrigger` and
 * `DialogContent`.
 *
 * Vendored from the [shadcn/ui Dialog](https://ui.shadcn.com/docs/components/base/dialog).
 *
 * @summary for content that interrupts the current view until dismissed
 */
function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

/** The element that opens the dialog on click; pass `asChild` (a compat alias for Base UI's `render`) to merge onto an existing element instead of adding a new one. */
function DialogTrigger({
  asChild = false,
  render,
  children,
  ...props
}: DialogPrimitive.Trigger.Props & { asChild?: boolean }) {
  const resolvedRender =
    asChild && React.isValidElement(children)
      ? (children as React.ReactElement)
      : render;
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      render={resolvedRender}
      {...props}
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Trigger>
  );
}

/** Renders `DialogOverlay` and `DialogContent` into a portal; used internally by `DialogContent`, most consumers won't render this directly. */
function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

/** An element that closes the dialog when activated; pass `asChild` (a compat alias for `render`) to merge onto a custom close control (e.g. a footer button). */
function DialogClose({
  asChild = false,
  render,
  children,
  ...props
}: DialogPrimitive.Close.Props & { asChild?: boolean }) {
  const resolvedRender =
    asChild && React.isValidElement(children)
      ? (children as React.ReactElement)
      : render;
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      render={resolvedRender}
      {...props}
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Close>
  );
}

/** Dims the page behind the dialog; renders automatically inside `DialogContent`. */
function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

interface DialogContentProps extends DialogPrimitive.Popup.Props {
  /** Whether to render the default close button (X icon) in the top-right corner. */
  showCloseButton?: boolean;
}

/** The dialog's rendered surface — the modal panel most consumers configure with `DialogHeader`/`DialogFooter`. Portals itself and dims the background via `DialogOverlay`. */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

/** Groups `DialogTitle` and `DialogDescription`. */
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

/** Groups the dialog's actions in a muted footer bar, right-aligned from `sm` up (stacked, reversed, below `sm`). Set `showCloseButton` to append a default outline "Close" button. */
function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Whether to append a default outline "Close" button after the footer's children. */
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

/** The dialog's accessible name — required for screen readers; rendered as a heading-styled element. */
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

/** The dialog's accessible description, announced alongside the title; optional but recommended when the title alone doesn't convey the dialog's purpose. */
function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
