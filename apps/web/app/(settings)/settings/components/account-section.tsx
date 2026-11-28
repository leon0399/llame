"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { Alert, AlertAction, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { SoonChip } from "@/app/shell/soon-chip";
import { logoutAllSessions, useMe } from "@/lib/services/auth/queries";

/** One labelled line of a settings card: what it is on the left, its value
 *  or control on the right. */
function SettingLine({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{label}</p>
        {description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="min-w-0 shrink-0 text-sm">{children}</div>
    </div>
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
    <div className="divide-y">
      <SettingLine label="Name">
        <span className="text-muted-foreground">
          {me.data?.name ?? "Not set"}
        </span>
      </SettingLine>
      <SettingLine label="Email">
        <span className="break-all text-muted-foreground">
          {me.data?.email ?? "Not set"}
        </span>
      </SettingLine>
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
          void logoutAllSessions();
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
            <div className="divide-y">
              <SettingLine
                label="Password"
                description="Change the password you sign in with."
              >
                <SoonChip />
              </SettingLine>
              <SettingLine
                label="Sessions"
                description="Sign out of every browser and device at once."
              >
                <SignOutEverywhere />
              </SettingLine>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
