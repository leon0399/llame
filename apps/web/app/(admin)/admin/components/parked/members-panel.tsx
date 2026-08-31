// PARKED, UNWIRED (admin-area-org-tree change, D7): the members panel is
// deferred to a sequenced fast-follow change that re-homes this component
// (alongside role-picker.tsx) into the Administration area, wired to the
// org-tree's selected-unit footer (today's ported tree — ../../organizations
// — ships that footer's "Manage members" button disabled). Nothing imports
// this file today — it is kept, not deleted, so the fast-follow is a
// re-wire, not a rebuild. Membership grant/revoke/role-change remains fully
// available via the API in the meantime (accepted temporary regression).

"use client";

import { useState } from "react";

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

import { ApiErrorMessage } from "../../organizations/components/api-error-message";
import {
  ConfirmOwnerGrantDialog,
  MembershipRowDialogs,
} from "./member-confirm-dialogs";
import { RolePicker, roleLabel } from "./role-picker";

function GrantMembershipRow({
  userId,
  onUserIdChange,
  role,
  onRoleChange,
  onSubmit,
  submitDisabled,
}: {
  userId: string;
  onUserIdChange: (userId: string) => void;
  role: GrantableRole;
  onRoleChange: (role: GrantableRole) => void;
  onSubmit: () => void;
  submitDisabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1">
        <Label htmlFor="grant-user-id">User ID</Label>
        <Input
          id="grant-user-id"
          value={userId}
          onChange={(e) => onUserIdChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="User id"
        />
      </div>
      <RolePicker value={role} onChange={onRoleChange} />
      <Button onClick={onSubmit} disabled={submitDisabled}>
        Grant
      </Button>
    </div>
  );
}

/** The form's field state and dual immediate/confirm-first submit — split
 *  out so `GrantMembershipForm` composes only markup. */
function useGrantMembershipForm(orgUnitId: string) {
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

  const handleSubmit = () => {
    if (!userId.trim()) return;
    if (role === "owner") {
      setConfirmOwnerGrant(true);
      return;
    }
    submit();
  };

  return {
    userId,
    setUserId,
    role,
    setRole,
    grant,
    confirmOwnerGrant,
    setConfirmOwnerGrant,
    submit,
    handleSubmit,
  };
}

function GrantMembershipForm({ orgUnitId }: { orgUnitId: string }) {
  const {
    userId,
    setUserId,
    role,
    setRole,
    grant,
    confirmOwnerGrant,
    setConfirmOwnerGrant,
    submit,
    handleSubmit,
  } = useGrantMembershipForm(orgUnitId);

  return (
    <div className="flex flex-col gap-2">
      <GrantMembershipRow
        userId={userId}
        onUserIdChange={setUserId}
        role={role}
        onRoleChange={setRole}
        onSubmit={handleSubmit}
        submitDisabled={!userId.trim() || grant.isPending}
      />
      <ApiErrorMessage error={grant.error} />

      <ConfirmOwnerGrantDialog
        open={confirmOwnerGrant}
        onOpenChange={setConfirmOwnerGrant}
        userId={userId}
        onConfirm={() => {
          submit();
          setConfirmOwnerGrant(false);
        }}
      />
    </div>
  );
}

/** The role control — a live `RolePicker`, or a disabled label when the
 *  role isn't settable (service_account, D3: no picker to cast it into). */
function MembershipRoleControl({
  membership,
  onChange,
  disabled,
}: {
  membership: MembershipResponse;
  onChange: (role: GrantableRole) => void;
  disabled: boolean;
}) {
  if (!isGrantableRole(membership.role)) {
    return (
      <Button variant="outline" size="sm" disabled>
        {roleLabel(membership.role)}
      </Button>
    );
  }
  return (
    <RolePicker
      value={membership.role}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

type MembershipRowProps = {
  membership: MembershipResponse;
  orgUnitId: string;
  isSelf: boolean;
};

function MembershipRowSummary({
  membership,
  isSelf,
  onChangeRole,
  changeRolePending,
  onRequestRevoke,
}: {
  membership: MembershipResponse;
  isSelf: boolean;
  onChangeRole: (role: GrantableRole) => void;
  changeRolePending: boolean;
  onRequestRevoke: () => void;
}) {
  return (
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
        <MembershipRoleControl
          membership={membership}
          onChange={onChangeRole}
          disabled={changeRolePending}
        />
        <Button variant="ghost" size="sm" onClick={onRequestRevoke}>
          {isSelf ? "Leave" : "Revoke"}
        </Button>
      </div>
    </div>
  );
}

/** The row's mutations, confirm-dialog open state, and role-change gating —
 *  split out so `MembershipRow` composes only markup. */
function useMembershipRowState(
  membership: MembershipResponse,
  orgUnitId: string,
) {
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

  return {
    changeRole,
    revoke,
    confirmOwnerRole,
    setConfirmOwnerRole,
    confirmRevoke,
    setConfirmRevoke,
    applyRole,
  };
}

function MembershipRow({ membership, orgUnitId, isSelf }: MembershipRowProps) {
  const {
    changeRole,
    revoke,
    confirmOwnerRole,
    setConfirmOwnerRole,
    confirmRevoke,
    setConfirmRevoke,
    applyRole,
  } = useMembershipRowState(membership, orgUnitId);

  return (
    <div
      className="flex flex-col gap-1 py-2"
      data-testid={`membership-row-${membership.userId}`}
    >
      <MembershipRowSummary
        membership={membership}
        isSelf={isSelf}
        onChangeRole={applyRole}
        changeRolePending={changeRole.isPending}
        onRequestRevoke={() => setConfirmRevoke(true)}
      />
      {/* The owner-role change has its own confirmation dialog (below) that
          surfaces changeRole.error inline; every other role change applies
          immediately, so its error must be shown here instead or it's never
          seen. */}
      {!confirmOwnerRole && <ApiErrorMessage error={changeRole.error} />}

      <MembershipRowDialogs
        membership={membership}
        orgUnitId={orgUnitId}
        isSelf={isSelf}
        confirmOwnerRole={confirmOwnerRole}
        onConfirmOwnerRoleChange={setConfirmOwnerRole}
        changeRole={changeRole}
        confirmRevoke={confirmRevoke}
        onConfirmRevokeChange={setConfirmRevoke}
        revoke={revoke}
      />
    </div>
  );
}

function myRoleDescription(
  myRoleQuery: ReturnType<typeof useMyEffectiveRoleQuery>,
  viaUnit: OrgUnitResponse | undefined,
): string {
  if (myRoleQuery.isLoading) return "Loading your role…";
  if (!myRoleQuery.data) return "You have no role on this unit.";
  const inherited = myRoleQuery.data.inherited
    ? ` (inherited from ${viaUnit?.name ?? "an ancestor"})`
    : "";
  return `Your role here: ${roleLabel(myRoleQuery.data.role)}${inherited}`;
}

function MembershipRoster({
  membershipsQuery,
  orgUnitId,
  myUserId,
}: {
  membershipsQuery: ReturnType<typeof useMembershipsQuery>;
  orgUnitId: string;
  myUserId: string | undefined;
}) {
  return (
    <div className="divide-y">
      {membershipsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading roster…</p>
      )}
      {!membershipsQuery.isLoading && membershipsQuery.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No members visible here yet.
        </p>
      )}
      {membershipsQuery.data?.map((membership) => (
        <MembershipRow
          key={membership.id}
          membership={membership}
          orgUnitId={orgUnitId}
          isSelf={membership.userId === myUserId}
        />
      ))}
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
  units: Array<OrgUnitResponse>;
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
          {myRoleDescription(myRoleQuery, viaUnit)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GrantMembershipForm orgUnitId={orgUnitId} />
        <MembershipRoster
          membershipsQuery={membershipsQuery}
          orgUnitId={orgUnitId}
          myUserId={me?.id}
        />
      </CardContent>
    </Card>
  );
}
