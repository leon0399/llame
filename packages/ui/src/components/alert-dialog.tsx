"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";

/**
 * AlertDialog interrupts the user with a modal that demands an explicit
 * response before continuing — for confirming a consequential or
 * irreversible action, not as a general-purpose dialog (use `Dialog` for
 * that). Content underneath stays inert until dismissed.
 *
 * Vendored from the [shadcn/ui Alert Dialog](https://ui.shadcn.com/docs/components/base/alert-dialog).
 *
 * @summary for confirming a consequential or irreversible action
 */
function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

/** The element that opens the alert dialog on click; pass `render` to merge onto an existing element instead of adding a new one. */
function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

/** Renders `AlertDialogOverlay` and `AlertDialogContent` into a portal; used internally by `AlertDialogContent`, most consumers won't render this directly. */
function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
}

/** Dims the page behind the alert dialog; renders automatically inside `AlertDialogContent`. */
function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

/** The alert dialog's rendered surface — the modal panel most consumers configure with `AlertDialogHeader`/`AlertDialogFooter`. Portals itself and dims the background via `AlertDialogOverlay`. */
function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  /**
   * Layout density. `sm` renders a narrower dialog with a two-column
   * footer, for compact/low-stakes confirmations (e.g. device permission
   * prompts). `default` fits standard confirmations with longer copy.
   */
  size?: "default" | "sm";
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

/** Groups `AlertDialogMedia`, `AlertDialogTitle`, and `AlertDialogDescription`; center-aligns on narrow screens, left-aligns from `sm` up on the `default` size. */
function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className,
      )}
      {...props}
    />
  );
}

/** Groups the alert dialog's actions in a muted footer bar, right-aligned from `sm` up (stacked, reversed, below `sm`; two-column on the `sm` content size). */
function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

/**
 * AlertDialogMedia leads the header with an icon or image that anchors the
 * confirmation's subject (e.g. a device icon for a pairing prompt, a
 * destructive icon for a delete confirmation).
 *
 * @summary for a leading icon/image anchoring the confirmation's subject
 */
function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
        className,
      )}
      {...props}
    />
  );
}

/** The alert dialog's accessible name — required for screen readers; rendered as a heading-styled element. */
function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className,
      )}
      {...props}
    />
  );
}

/** The alert dialog's accessible description, announced alongside the title — state the consequence of the action being confirmed (e.g. what gets deleted, that it cannot be undone). */
function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * AlertDialogAction is the dialog's primary, affirmative response — the
 * button that carries out the action being confirmed. Set
 * `variant="destructive"` when that action is irreversible (e.g. delete).
 *
 * Unlike Radix's `AlertDialog.Action`, this is a plain `Button` and does
 * **not** auto-close the dialog on click. Drive the dialog with controlled
 * `open`/`onOpenChange` and close it from your `onClick` handler (typically
 * on success), so it can stay open on failure.
 *
 * @summary for the dialog's confirming action
 */
function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="alert-dialog-action"
      className={cn(className)}
      {...props}
    />
  );
}

/**
 * AlertDialogCancel is the dialog's safe, dismissing response — closes
 * without performing the action and returns focus to the trigger.
 *
 * @summary for the dialog's dismissing action
 */
function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
