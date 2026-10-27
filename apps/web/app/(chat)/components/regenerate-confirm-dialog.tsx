"use client";

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

type RegenerateConfirmDialogProps = {
  /** The tool names a Regenerate would leave behind; empty = nothing to ask. */
  discarded: ReadonlyArray<string>;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The calls the dialog names, each quoted by its tool name. */
function DiscardedCalls({ names }: { names: ReadonlyArray<string> }) {
  return (
    <>
      {names.map((name, index) => (
        <span key={name}>
          {index > 0 && (index === names.length - 1 ? " and " : ", ")}
          <span className="font-mono">{name}</span>
        </span>
      ))}
    </>
  );
}

/**
 * The confirmation a Regenerate owes when the reply it discards ran a call
 * whose effects stay (turn-actions D13). It names those calls, says the
 * effects remain, and warns that the new answer cannot see them; a cancel
 * sends nothing.
 *
 * @summary names the calls a Regenerate discards and explains what stays
 */
export function RegenerateConfirmDialog({
  discarded,
  open,
  onConfirm,
  onCancel,
}: RegenerateConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regenerate this answer?</AlertDialogTitle>
          <AlertDialogDescription>
            This answer ran <DiscardedCalls names={discarded} />. Their effects
            stay, and the new answer will not see them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Regenerate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
