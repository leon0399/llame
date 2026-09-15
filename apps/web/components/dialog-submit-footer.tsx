"use client";

import { Button } from "@workspace/ui/components/button";
import { DialogFooter } from "@workspace/ui/components/dialog";

/**
 * DialogSubmitFooter is the Cancel + primary-action footer every form dialog
 * in the app ends with — create and rename a project, rename a chat, and the
 * org-unit create/rename/move dialogs. Extracted at the third identical copy;
 * the callers move together because the pair of buttons, their order, and
 * their variants are one decision.
 *
 * Confirmation dialogs are a different shape and stay on
 * `AlertDialogFooter` with `AlertDialogCancel`/`AlertDialogAction`: those
 * close themselves, and their primary action carries destructive intent.
 *
 * @summary the Cancel + submit footer a form dialog ends with
 */
export function DialogSubmitFooter({
  onCancel,
  onSubmit,
  submitLabel,
  submitDisabled,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  /** Label for the primary action, e.g. `"Create"`, `"Save"`, `"Move"`. */
  submitLabel: string;
  submitDisabled: boolean;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onSubmit} disabled={submitDisabled}>
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}
