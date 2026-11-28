"use client";

import { useState } from "react";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { SoonChip } from "@/app/shell/soon-chip";
import { SettingField } from "@/components/setting-field";
import { logoutAllSessions, useMe } from "@/lib/services/auth/queries";

/** A read-only account value at the end of its label's line. */
function ProfileValue({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <SettingField
      label={label}
      action={
        <span className="text-sm break-all text-muted-foreground">
          {value ?? "Not set"}
        </span>
      }
    />
  );
}

function Profile() {
  const me = useMe();

  if (me.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-64" />
      </div>
    );
  }

  // Without this, a failed read would show "Not set" for both lines, as if
  // the account had no name or email.
  if (me.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load your account.</AlertTitle>
        <AlertAction>
          <Button variant="outline" size="sm" onClick={() => void me.refetch()}>
            Try again
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ProfileValue label="Name" value={me.data?.name} />
      <ProfileValue label="Email" value={me.data?.email} />
    </div>
  );
}

/** Ends every session of the account, this one included, so the page goes
 *  to the login screen when it completes. */
function SignOutEverywhere() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Sign out everywhere
      </Button>
      <ConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Sign out of every session?"
        description="Every browser and device signed in to this account is signed out, this one included."
        confirmLabel="Sign out everywhere"
        isPending={pending}
        onConfirm={() => {
          setPending(true);
          // A failed revoke still signs this browser out and redirects to the
          // login page, so the rejection has nothing left to report.
          logoutAllSessions().catch(() => undefined);
        }}
      />
    </>
  );
}

/** The account's identity and its sessions. Editing the name, the email
 *  and the password has no API yet, so those are visible "soon" lines. */
export function AccountSection() {
  return (
    <>
      <Card>
        <CardContent>
          <Profile />
        </CardContent>
      </Card>
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Security</h2>
        <Card>
          <CardContent>
            <div className="flex flex-col gap-6">
              <SettingField
                label="Password"
                description="Change the password you sign in with."
                action={<SoonChip />}
              />
              <SettingField
                label="Sessions"
                description="Sign out of every browser and device at once."
                action={<SignOutEverywhere />}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
