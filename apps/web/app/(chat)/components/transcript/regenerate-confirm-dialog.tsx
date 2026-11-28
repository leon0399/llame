"use client";

import { RefreshCwIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Badge } from "@workspace/ui/components/badge";

type RegenerateConfirmDialogProps = {
  /** The tool names a Regenerate would leave behind; empty = nothing to ask. */
  discarded: ReadonlyArray<string>;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The calls the dialog names, one badge per tool name. */
function DiscardedCalls({ names }: { names: ReadonlyArray<string> }) {
  return (
    <ul aria-label="Calls that already ran" className="flex flex-wrap gap-1">
      {names.map((name) => (
        <li key={name}>
          <Badge variant="secondary">
            <code>{name}</code>
          </Badge>
        </li>
      ))}
    </ul>
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
          <AlertDialogMedia>
            <RefreshCwIcon aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Regenerate this answer?</AlertDialogTitle>
          <AlertDialogDescription>
            This answer ran the calls below. Their effects stay, and the new
            answer will not see them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DiscardedCalls names={discarded} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Regenerate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
