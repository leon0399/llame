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

function depthOf(unit: OrgUnitResponse): number {
  return unit.path.split("/").length - 1;
}

/**
 * Flat, path-ordered list rendered as an indented tree (org-admin-ui spec
 * "Visible trees render nested"): the API already returns units in
 * parent-before-child order (materialized id-path sorts as a valid preorder
 * traversal — D5), so this only needs to compute indentation, not build a
 * tree structure client-side.
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

  return (
    <div role="tree" className="flex flex-col">
      {units.map((unit) => {
        const depth = depthOf(unit);
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
                <DropdownMenuItem onSelect={() => setCreateChildFor(unit)}>
                  <FolderPlusIcon />
                  Add child
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRenaming(unit)}>
                  <PenLineIcon />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMoving(unit)}>
                  <MoveIcon />
                  Move
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleting(unit)}
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
