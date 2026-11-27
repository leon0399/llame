"use client";

import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";

/**
 * The Dialog frame the project and repository dialogs share: a title and a
 * body, nothing else. The body is a child rather than a prop set, so its field
 * state lives BELOW `DialogContent`: the content unmounts while the dialog is
 * closed, which re-seeds the fields on every open without a mount-time reset.
 *
 * @summary a titled Dialog around a body that re-seeds on every open
 */
export function DialogFrame({
  open,
  onOpenChange,
  title,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Sizing for the dialog itself, such as a wider `sm:max-w-*`. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
