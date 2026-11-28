"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";

/*
 * Leaving a form with unsaved edits asks first. A reload, a closed tab or a
 * typed address gets the browser's own prompt (`beforeunload`; browsers no
 * longer show a page's text). A link inside the app gets this dialog: the
 * App Router has no navigation event to block, so a same-origin link click
 * is held in the capture phase, before Next's Link handles it. The browser's
 * Back button cannot be held this way and is left to the browser.
 */

/** The in-app destination a click would navigate to, or null when it is not
 *  a plain left click on a same-origin link to another page. */
function heldDestination(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;

  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }

  const target = event.target;

  if (!(target instanceof Element)) return null;

  const link = target.closest("a[href]");

  if (!(link instanceof HTMLAnchorElement)) return null;

  if (link.target === "_blank" || link.hasAttribute("download")) return null;

  const url = new URL(link.href);

  if (url.origin !== window.location.origin) return null;

  const here = window.location.pathname + window.location.search;

  if (url.pathname + url.search === here) return null;

  return url.pathname + url.search + url.hash;
}

/** While `dirty`, the browser's prompt guards a reload or a closed tab. */
function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/** While `dirty`, holds in-app link clicks and reports where they went. */
function useHeldLinks(dirty: boolean, onHold: (href: string) => void) {
  useEffect(() => {
    if (!dirty) return;

    const onClick = (event: MouseEvent) => {
      const href = heldDestination(event);

      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      onHold(href);
    };

    document.addEventListener("click", onClick, { capture: true });

    return () =>
      document.removeEventListener("click", onClick, { capture: true });
  }, [dirty, onHold]);
}

export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [held, setHeld] = useState<string | null>(null);

  useBeforeUnload(dirty);
  useHeldLinks(dirty, setHeld);

  return (
    <AlertDialog
      open={held !== null}
      onOpenChange={(open) => {
        if (!open) setHeld(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your edits on this page have not been saved. Leaving discards them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (held === null) return;
              // SAFETY: `held` is a same-origin path read from an anchor the
              // app rendered, which is what typedRoutes' Route stands for.
              router.push(held as Route);
            }}
          >
            Discard and leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
