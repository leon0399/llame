"use client";

import { useState } from "react";
import {
  FolderPlusIcon,
  MoreHorizontalIcon,
  MoveIcon,
  PenLineIcon,
  TrashIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";

import type { OrgUnitResponse } from "@/lib/services/org-units/types";

import {
  CreateOrgUnitDialog,
  DeleteOrgUnitDialog,
  MoveOrgUnitDialog,
  RenameOrgUnitDialog,
} from "./org-unit-dialogs";

// Indentation per tree-depth level. A computed layout offset, not a color or
// spacing-scale choice DESIGN.md governs — structural nesting, same idea as
// any tree/outline view.
const INDENT_REM = 1.25;

/**
 * Indentation depth = the number of the unit's ancestors actually PRESENT in
 * the visible list — not raw path depth. RLS can grant visibility of a deep
 * unit without its ancestors (membership on the unit only, no role higher
 * up); raw-path indentation would render such a unit floating at depth N
 * under nothing. Counting visible ancestors renders it as a root of the
 * caller's visible forest instead.
 */
function depthOf(unit: OrgUnitResponse, visibleIds: Set<string>): number {
  return unit.path
    .split("/")
    .slice(0, -1)
    .filter((ancestorId) => visibleIds.has(ancestorId)).length;
}

/**
 * Flat, path-ordered list rendered as an indented tree (org-admin-ui spec
 * "Visible trees render nested"): the API already returns units in
 * parent-before-child order (materialized id-path sorts as a valid preorder
 * traversal — D5), so this only needs to compute indentation, not build a
 * tree structure client-side.
 *
 * PORTED AS-IS from the old `/settings/organizations` page (admin-area-org-
 * tree change, task 2.1) — the real connector-line/chevron/type-icon tree
 * redesign is a later wave (tasks.md section 3), not this change.
 */
export function OrgUnitsTree({
  units,
  selectedId,
  onSelect,
}: {
  units: OrgUnitResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [createChildFor, setCreateChildFor] = useState<OrgUnitResponse | null>(
    null,
  );
  const [renaming, setRenaming] = useState<OrgUnitResponse | null>(null);
  const [moving, setMoving] = useState<OrgUnitResponse | null>(null);
  const [deleting, setDeleting] = useState<OrgUnitResponse | null>(null);

  const visibleIds = new Set(units.map((unit) => unit.id));

  return (
    <div role="tree" className="flex flex-col">
      {units.map((unit) => {
        const depth = depthOf(unit, visibleIds);
        const isRoot = depth === 0;
        const isSelected = unit.id === selectedId;

        return (
          <div
            key={unit.id}
            role="treeitem"
            aria-selected={isSelected}
            data-testid={`org-unit-row-${unit.id}`}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md py-1.5 pr-1 text-sm hover:bg-accent",
              isSelected && "bg-accent",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(unit.id)}
              className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pl-2 text-left"
              style={{ paddingLeft: `${depth * INDENT_REM + 0.5}rem` }}
            >
              <span className={cn("truncate", isRoot && "font-semibold")}>
                {unit.name}
              </span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 shrink-0">
                  <MoreHorizontalIcon />
                  <span className="sr-only">Actions for {unit.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Let the dropdown close normally, then open the dialog a
                    tick later — same pattern as chat-item-dialogs.tsx's row
                    menu: opening a dialog synchronously from onSelect can
                    race the dropdown's own close/unmount (both are
                    Radix-portaled, animated-exit content), which risks two
                    surfaces briefly coexisting in the DOM. */}
                <DropdownMenuItem
                  onSelect={() => setTimeout(() => setCreateChildFor(unit), 0)}
                >
                  <FolderPlusIcon />
                  Add child
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setTimeout(() => setRenaming(unit), 0)}
                >
                  <PenLineIcon />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setTimeout(() => setMoving(unit), 0)}
                >
                  <MoveIcon />
                  Move
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setTimeout(() => setDeleting(unit), 0)}
                >
                  <TrashIcon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}

      {createChildFor && (
        <CreateOrgUnitDialog
          parent={createChildFor}
          open
          onOpenChange={(open) => !open && setCreateChildFor(null)}
        />
      )}
      {renaming && (
        <RenameOrgUnitDialog
          unit={renaming}
          open
          onOpenChange={(open) => !open && setRenaming(null)}
        />
      )}
      {moving && (
        <MoveOrgUnitDialog
          unit={moving}
          units={units}
          open
          onOpenChange={(open) => !open && setMoving(null)}
        />
      )}
      {deleting && (
        <DeleteOrgUnitDialog
          unit={deleting}
          open
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      )}
    </div>
  );
}
