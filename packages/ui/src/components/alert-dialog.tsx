"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";

/**
 * AlertDialog interrupts the user with a modal that demands an explicit
 * response before continuing — for confirming a consequential or
 * irreversible action, not as a general-purpose dialog (use `Dialog` for
 * that; content underneath stays reachable through neither).
 *
 * Vendored from the [shadcn/ui Alert Dialog](https://ui.shadcn.com/docs/components/radix/alert-dialog).
 *
 * @summary for confirming a consequential or irreversible action
 */
function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

/** The element that opens the alert dialog on click; pass `asChild` to merge onto an existing element instead of adding a new one. */
function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

/** Renders `AlertDialogOverlay` and `AlertDialogContent` into a portal; used internally by `AlertDialogContent`, most consumers won't render this directly. */
function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
}

/** Dims the page behind the alert dialog; renders automatically inside `AlertDialogContent`. */
function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

interface AlertDialogContentProps
  extends React.ComponentProps<typeof AlertDialogPrimitive.Content> {
  /**
   * Layout density. `sm` renders a narrower dialog with a two-column
   * footer, for compact/low-stakes confirmations (e.g. device permission
   * prompts). `default` fits standard confirmations with longer copy.
   */
  size?: "default" | "sm";
}

/** The alert dialog's rendered surface — the modal panel most consumers configure with `AlertDialogHeader`/`AlertDialogFooter`. Portals itself and dims the background via `AlertDialogOverlay`. */
function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialogContentProps) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "group/alert-dialog-content fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 data-[size=sm]:max-w-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[size=default]:sm:max-w-lg",
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
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className,
      )}
      {...props}
    />
  );
}

/** Groups the alert dialog's actions, right-aligned from `sm` up (stacked, reversed, below `sm`; side-by-side on the `sm` content size). */
function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
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
        "text-lg font-semibold sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
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
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * AlertDialogMedia leads the header with an icon or image that anchors the
 * confirmation's subject (e.g. a device icon for a pairing prompt, a
 * destructive icon for a delete confirmation). Not part of upstream Radix —
 * a shadcn/ui composition on top of it.
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
        "mb-2 inline-flex size-16 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-8",
        className,
      )}
      {...props}
    />
  );
}

interface AlertDialogButtonProps {
  /** Button visual style, from the shared `Button` variant scale. */
  variant?: React.ComponentProps<typeof Button>["variant"];
  /** Button density/size, from the shared `Button` size scale. */
  size?: React.ComponentProps<typeof Button>["size"];
}

/**
 * AlertDialogAction is the dialog's primary, affirmative response — the
 * button that carries out the action being confirmed. Set
 * `variant="destructive"` when that action is irreversible (e.g. delete).
 *
 * @summary for the dialog's confirming action
 */
function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  AlertDialogButtonProps) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action
        data-slot="alert-dialog-action"
        className={cn(className)}
        {...props}
      />
    </Button>
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
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  AlertDialogButtonProps) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
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
