"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { useOrgUnitsQuery } from "@/lib/services/org-units/queries";

import { CreateOrgUnitDialog } from "./components/org-unit-dialogs";
import { OrgUnitsTree } from "./components/org-tree";

/**
 * PORTED from the old `/settings/organizations` page (admin-area-org-tree
 * change, task 2.1) — same tree/dialogs, same unit-selection state (the tree
 * needs it), MINUS the members panel: D7 defers members management to a
 * fast-follow change that re-homes the parked `members-panel`/`role-picker`
 * components (see ../components/parked/) into this area. The design's
 * disabled "Manage members" footer placeholder + the real connector/chevron
 * tree redesign are also later-wave work (tasks.md sections 3–4), not this
 * change.
 */
export default function OrganizationsPage() {
  const { data: units, isLoading } = useOrgUnitsQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createRootOpen, setCreateRootOpen] = useState(false);

  const hasUnits = (units?.length ?? 0) > 0;

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-y-auto px-5 py-12">
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Organizations</h2>
        <p className="text-muted-foreground">
          Create organizations, nest units under them, and manage who belongs
          where.
        </p>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2 lg:max-w-2xl">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {!isLoading && !hasUnits && (
        // org-admin-ui spec "First-run empty state": explain what an
        // organization is, offer creation, instead of a blank list.
        <Card className="lg:max-w-2xl">
          <CardHeader>
            <CardTitle>No organizations yet</CardTitle>
            <CardDescription>
              An organization is the top-level container for your teams,
              chats, and members — everything else in llame is scoped
              underneath one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setCreateRootOpen(true)}>
              <PlusIcon />
              Create organization
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && hasUnits && (
        <Card className="lg:max-w-2xl">
          <CardHeader>
            <CardTitle>Your organizations</CardTitle>
            <CardDescription>Select a unit to manage it.</CardDescription>
            <CardAction>
              <Button size="sm" onClick={() => setCreateRootOpen(true)}>
                <PlusIcon />
                New organization
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <OrgUnitsTree
              units={units ?? []}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </CardContent>
        </Card>
      )}

      <CreateOrgUnitDialog
        open={createRootOpen}
        onOpenChange={setCreateRootOpen}
      />
    </div>
  );
}
