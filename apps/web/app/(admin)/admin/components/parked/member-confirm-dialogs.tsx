// PARKED, UNWIRED — see members-panel.tsx's header comment. This file holds
// that component's ownership-affecting confirmation dialogs, split out once
// members-panel.tsx's own line count outgrew the project's 500-line cap.

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

import type {
  useChangeMembershipRole,
  useRevokeMembership,
} from "@/lib/services/org-units/mutations";
import type { MembershipResponse } from "@/lib/services/org-units/types";

import { ApiErrorMessage } from "../../organizations/components/api-error-message";

/** The Cancel + confirm-action footer every `AlertDialog` below shares.
 *  `onConfirm` is the raw click handler (not just a callback) so each
 *  dialog keeps full control of `preventDefault`/close-on-success timing —
 *  they are NOT identical (see each dialog's own comment). */
function ConfirmAlertFooter({
  onConfirm,
  confirmLabel,
  confirmClassName,
}: {
  onConfirm: (e: React.MouseEvent) => void;
  confirmLabel: string;
  confirmClassName?: string;
}) {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={onConfirm} className={confirmClassName}>
        {confirmLabel}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

/** Grant/transfer `owner` is ownership-affecting — confirm before sending
 *  (spec: "Destructive/ownership-affecting actions… require an explicit
 *  confirmation naming the consequence"). Split out from
 *  `GrantMembershipForm` as its own self-contained control. Unlike the
 *  other two confirm dialogs below, this one closes immediately on
 *  confirm rather than waiting for the mutation to settle — grants are
 *  optimistic here, matching the non-owner grant path just above it. */
export function ConfirmOwnerGrantDialog({
  open,
  onOpenChange,
  userId,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Grant ownership?</AlertDialogTitle>
          <AlertDialogDescription>
            This makes “{userId}” a co-owner of this unit, with full control
            including the ability to delete it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ConfirmAlertFooter
          onConfirm={onConfirm}
          confirmLabel="Grant ownership"
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ConfirmOwnerRoleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: MembershipResponse;
  orgUnitId: string;
  changeRole: ReturnType<typeof useChangeMembershipRole>;
};

/** Promoting to owner is ownership-affecting — confirm first, and surface
 *  the error here (not the row's own `ApiErrorMessage`) since this dialog
 *  stays open on failure to show it. Split out from `MembershipRow`. */
function ConfirmOwnerRoleDialog({
  open,
  onOpenChange,
  membership,
  orgUnitId,
  changeRole,
}: ConfirmOwnerRoleDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // Clear a previous attempt's error both on open (so reopening
        // doesn't flash stale copy before this attempt has even run) and
        // on close (so cancelling out of a failed owner-grant attempt
        // doesn't leak that error into the row's own ApiErrorMessage,
        // which would then read as if the last NON-owner change failed).
        changeRole.reset();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Make owner?</AlertDialogTitle>
          <AlertDialogDescription>
            This grants full control of this unit, including deletion, to{" "}
            {membership.userId}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ApiErrorMessage error={changeRole.error} />
        <ConfirmAlertFooter
          onConfirm={(e) => {
            // Radix closes AlertDialog.Action on click unless prevented —
            // this dialog must stay open on failure so ApiErrorMessage
            // above can show it; only onSuccess below closes it.
            e.preventDefault();
            changeRole.mutate(
              { orgUnitId, userId: membership.userId, role: "owner" },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
          confirmLabel="Make owner"
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Revoke (or, for the current user, "Leave") — split out from
 *  `MembershipRow` as its own self-contained confirmation. */
type ConfirmRevokeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: MembershipResponse;
  orgUnitId: string;
  isSelf: boolean;
  revoke: ReturnType<typeof useRevokeMembership>;
};

function ConfirmRevokeHeader({
  membership,
  isSelf,
}: {
  membership: MembershipResponse;
  isSelf: boolean;
}) {
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>
        {isSelf ? "Leave this unit?" : `Revoke ${membership.userId}?`}
      </AlertDialogTitle>
      <AlertDialogDescription>
        {isSelf
          ? "You’ll lose your role and access here. An admin or owner can re-add you later."
          : `This removes ${membership.userId}'s role and access on this unit.`}
      </AlertDialogDescription>
    </AlertDialogHeader>
  );
}

function ConfirmRevokeDialog({
  open,
  onOpenChange,
  membership,
  orgUnitId,
  isSelf,
  revoke,
}: ConfirmRevokeDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) revoke.reset();
      }}
    >
      <AlertDialogContent>
        <ConfirmRevokeHeader membership={membership} isSelf={isSelf} />
        <ApiErrorMessage error={revoke.error} />
        <ConfirmAlertFooter
          onConfirm={(e) => {
            // Radix closes AlertDialog.Action on click unless prevented —
            // this dialog must stay open on failure so ApiErrorMessage
            // above can show it; only onSuccess below closes it.
            e.preventDefault();
            revoke.mutate(
              { orgUnitId, userId: membership.userId },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
          confirmLabel={isSelf ? "Leave" : "Revoke"}
          confirmClassName="bg-destructive text-white hover:bg-destructive/90"
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

type MembershipRowDialogsProps = {
  membership: MembershipResponse;
  orgUnitId: string;
  isSelf: boolean;
  confirmOwnerRole: boolean;
  onConfirmOwnerRoleChange: (open: boolean) => void;
  changeRole: ReturnType<typeof useChangeMembershipRole>;
  confirmRevoke: boolean;
  onConfirmRevokeChange: (open: boolean) => void;
  revoke: ReturnType<typeof useRevokeMembership>;
};

/** Both of `MembershipRow`'s confirmation dialogs, composed together — the
 *  row itself only owns their open state and the mutation hooks. */
export function MembershipRowDialogs({
  membership,
  orgUnitId,
  isSelf,
  confirmOwnerRole,
  onConfirmOwnerRoleChange,
  changeRole,
  confirmRevoke,
  onConfirmRevokeChange,
  revoke,
}: MembershipRowDialogsProps) {
  return (
    <>
      <ConfirmOwnerRoleDialog
        open={confirmOwnerRole}
        onOpenChange={onConfirmOwnerRoleChange}
        membership={membership}
        orgUnitId={orgUnitId}
        changeRole={changeRole}
      />
      <ConfirmRevokeDialog
        open={confirmRevoke}
        onOpenChange={onConfirmRevokeChange}
        membership={membership}
        orgUnitId={orgUnitId}
        isSelf={isSelf}
        revoke={revoke}
      />
    </>
  );
}
