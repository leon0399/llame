"use client";

import { useState } from "react";

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
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";

import { useMe } from "@/lib/services/auth/queries";
import {
  useChangeMembershipRole,
  useGrantMembership,
  useRevokeMembership,
} from "@/lib/services/org-units/mutations";
import {
  useMembershipsQuery,
  useMyEffectiveRoleQuery,
} from "@/lib/services/org-units/queries";
import type {
  GrantableRole,
  MembershipResponse,
  OrgUnitResponse,
} from "@/lib/services/org-units/types";
import { isGrantableRole } from "@/lib/services/org-units/types";

import { ApiErrorMessage } from "./api-error-message";
import { RolePicker, roleLabel } from "./role-picker";

function GrantMembershipForm({ orgUnitId }: { orgUnitId: string }) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<GrantableRole>("member");
  const [confirmOwnerGrant, setConfirmOwnerGrant] = useState(false);
  const grant = useGrantMembership();

  const submit = () => {
    const trimmed = userId.trim();
    if (!trimmed) return;
    grant.mutate(
      { orgUnitId, userId: trimmed, role },
      { onSuccess: () => setUserId("") },
    );
  };

  // Grant/transfer `owner` is ownership-affecting — confirm before sending
  // (spec: "Destructive/ownership-affecting actions… require an explicit
  // confirmation naming the consequence").
  const handleSubmit = () => {
    if (!userId.trim()) return;
    if (role === "owner") {
      setConfirmOwnerGrant(true);
      return;
    }
    submit();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="grant-user-id">User ID</Label>
          <Input
            id="grant-user-id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="User id"
          />
        </div>
        <RolePicker value={role} onChange={setRole} />
        <Button
          onClick={handleSubmit}
          disabled={!userId.trim() || grant.isPending}
        >
          Grant
        </Button>
      </div>
      <ApiErrorMessage error={grant.error} />

      <AlertDialog open={confirmOwnerGrant} onOpenChange={setConfirmOwnerGrant}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant ownership?</AlertDialogTitle>
            <AlertDialogDescription>
              This makes “{userId}” a co-owner of this unit, with full control
              including the ability to delete it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                submit();
                setConfirmOwnerGrant(false);
              }}
            >
              Grant ownership
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MembershipRow({
  membership,
  orgUnitId,
  isSelf,
}: {
  membership: MembershipResponse;
  orgUnitId: string;
  isSelf: boolean;
}) {
  const changeRole = useChangeMembershipRole();
  const revoke = useRevokeMembership();
  const [confirmOwnerRole, setConfirmOwnerRole] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const applyRole = (role: GrantableRole) => {
    if (role === membership.role) return;
    // Promoting to owner is ownership-affecting — confirm first.
    if (role === "owner") {
      setConfirmOwnerRole(true);
      return;
    }
    changeRole.mutate({ orgUnitId, userId: membership.userId, role });
  };

  return (
    <div
      className="flex flex-col gap-1 py-2"
      data-testid={`membership-row-${membership.userId}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {membership.userId}
            {isSelf && (
              <span className="ml-1.5 text-muted-foreground">(you)</span>
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isGrantableRole(membership.role) ? (
            <RolePicker
              value={membership.role}
              onChange={applyRole}
              disabled={changeRole.isPending}
            />
          ) : (
            // service_account is not a settable role (D3) — no picker to
            // cast it into.
            <Button variant="outline" size="sm" disabled>
              {roleLabel(membership.role)}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRevoke(true)}
          >
            {isSelf ? "Leave" : "Revoke"}
          </Button>
        </div>
      </div>
      {/* The owner-role change has its own confirmation dialog (below) that
          surfaces changeRole.error inline; every other role change applies
          immediately, so its error must be shown here instead or it's never
          seen. */}
      {!confirmOwnerRole && <ApiErrorMessage error={changeRole.error} />}

      <AlertDialog
        open={confirmOwnerRole}
        onOpenChange={(open) => {
          setConfirmOwnerRole(open);
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
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Radix closes AlertDialog.Action on click unless prevented —
                // this dialog must stay open on failure so ApiErrorMessage
                // above can show it; only onSuccess below closes it.
                e.preventDefault();
                changeRole.mutate(
                  { orgUnitId, userId: membership.userId, role: "owner" },
                  { onSuccess: () => setConfirmOwnerRole(false) },
                );
              }}
            >
              Make owner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmRevoke}
        onOpenChange={(open) => {
          setConfirmRevoke(open);
          if (open) revoke.reset();
        }}
      >
        <AlertDialogContent>
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
          <ApiErrorMessage error={revoke.error} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Radix closes AlertDialog.Action on click unless prevented —
                // this dialog must stay open on failure so ApiErrorMessage
                // above can show it; only onSuccess below closes it.
                e.preventDefault();
                revoke.mutate(
                  { orgUnitId, userId: membership.userId },
                  { onSuccess: () => setConfirmRevoke(false) },
                );
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isSelf ? "Leave" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Roster + "my role here" + grant form for a selected unit (org-admin-ui
 * spec "Members panel"). No local authorization: every control stays
 * enabled and lets the server's 403/409 surface through `ApiErrorMessage`.
 */
export function MembersPanel({
  orgUnitId,
  units,
}: {
  orgUnitId: string;
  units: OrgUnitResponse[];
}) {
  const { data: me } = useMe();
  const unit = units.find((candidate) => candidate.id === orgUnitId);
  const membershipsQuery = useMembershipsQuery(orgUnitId);
  const myRoleQuery = useMyEffectiveRoleQuery(orgUnitId);

  const viaUnit = myRoleQuery.data
    ? units.find((candidate) => candidate.id === myRoleQuery.data?.viaOrgUnitId)
    : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members{unit ? ` — ${unit.name}` : ""}</CardTitle>
        <CardDescription>
          {myRoleQuery.isLoading
            ? "Loading your role…"
            : myRoleQuery.data
              ? `Your role here: ${roleLabel(myRoleQuery.data.role)}${
                  myRoleQuery.data.inherited
                    ? ` (inherited from ${viaUnit?.name ?? "an ancestor"})`
                    : ""
                }`
              : "You have no role on this unit."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GrantMembershipForm orgUnitId={orgUnitId} />

        <div className="divide-y">
          {membershipsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading roster…</p>
          )}
          {!membershipsQuery.isLoading &&
            membershipsQuery.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No members visible here yet.
              </p>
            )}
          {membershipsQuery.data?.map((membership) => (
            <MembershipRow
              key={membership.id}
              membership={membership}
              orgUnitId={orgUnitId}
              isSelf={membership.userId === me?.id}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
