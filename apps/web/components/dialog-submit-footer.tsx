"use client";

import { Button } from "@workspace/ui/components/button";
import { DialogFooter } from "@workspace/ui/components/dialog";
import { Kbd } from "@workspace/ui/components/kbd";
import { usePrimaryModifierKey } from "@workspace/ui/hooks/use-modifier-key";

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
  submitShortcut = false,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  /** Label for the primary action, e.g. `"Create"`, `"Save"`, `"Move"`. */
  submitLabel: string;
  submitDisabled: boolean;
  /** Whether the dialog submits on Ctrl/⌘+Enter, which the primary action
   *  then names. The dialog binds the keys itself. */
  submitShortcut?: boolean;
}) {
  const modifierKey = usePrimaryModifierKey();

  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        onClick={onSubmit}
        disabled={submitDisabled}
        aria-keyshortcuts={
          submitShortcut
            ? `${modifierKey === "⌘" ? "Meta" : "Control"}+Enter`
            : undefined
        }
      >
        {submitLabel}
        {submitShortcut ? (
          // Announced through `aria-keyshortcuts`, not the button's name.
          <Kbd aria-hidden="true">
            {modifierKey}
            <span>↵</span>
          </Kbd>
        ) : null}
      </Button>
    </DialogFooter>
  );
}
