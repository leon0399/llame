"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";

import { useOrgUnitsQuery } from "@/lib/services/org-units/queries";

import { OrgUnitsTree } from "./components/org-tree";

/**
 * Tree redesign (admin-area-org-tree change, tasks.md section 3): the real
 * connector/chevron/role-badge tree from the design lives entirely inside
 * `OrgUnitsTree` — it owns selection, expand/collapse, the unit-count pill,
 * the header actions, the legend, the selected-unit footer, and every
 * dialog. This page is just the section intro + data fetch + loading state.
 *
 * Members management is still API-only (D7 — accepted temporary
 * regression): the parked `members-panel`/`role-picker` components (see
 * ../components/parked/) are re-homed by the sequenced fast-follow.
 */
export default function OrganizationsPage() {
  const { data: units, isLoading } = useOrgUnitsQuery();

  return (
    <div className="flex h-full w-full flex-col gap-5.5 overflow-y-auto px-7 py-6.5">
      <div className="mx-auto w-full max-w-195 space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        <p className="max-w-prose text-sm leading-normal text-muted-foreground">
          Organization units form a tree — organizations at the root, with
          groups, teams, and departments nested underneath. Members and
          permissions inherit down the tree, so a role granted high up applies
          to everything below it.
        </p>
      </div>

      <div className="mx-auto w-full max-w-195">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <OrgUnitsTree units={units ?? []} />
        )}
      </div>
    </div>
  );
}
