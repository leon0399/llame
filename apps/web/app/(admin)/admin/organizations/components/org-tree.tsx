"use client";

import { useMemo, useState } from "react";
import {
  ChevronRightIcon,
  FolderPlusIcon,
  MoveIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";

import type { OrgUnitResponse } from "@/lib/services/org-units/types";

import {
  CreateOrgUnitDialog,
  DeleteBlockedOrgUnitDialog,
  DeleteOrgUnitDialog,
  MoveOrgUnitDialog,
  RenameOrgUnitDialog,
} from "./org-unit-dialogs";
import {
  collapsibleUnitIds,
  effectiveRoleFor,
  ORG_UNIT_TYPE_META,
  ORG_UNIT_TYPE_ORDER,
  ROLE_LABEL,
  visibleAncestorChain,
  buildRows,
  type GuideKind,
  type TreeRow,
} from "./org-tree-utils";

/**
 * Neutral-ink hairline (DESIGN.md §10/D6) — a `color-mix` on `--foreground`
 * at ~20%, exactly the design's connector color. No new hue, token-derived.
 */
const GUIDE_COLOR =
  "bg-[color-mix(in_oklab,var(--foreground)_20%,transparent)]";

function TreeGuide({ kind }: { kind: GuideKind }) {
  return (
    <span
      aria-hidden
      data-kind={kind}
      className="relative w-[22px] shrink-0 self-stretch"
    >
      {kind !== "blank" && (
        <span
          className={cn(
            "absolute left-[11px] w-px",
            GUIDE_COLOR,
            kind === "elbow" ? "top-0 h-1/2" : "top-0 bottom-0",
          )}
        />
      )}
      {(kind === "tee" || kind === "elbow") && (
        <span
          className={cn(
            "absolute left-[11px] top-1/2 h-px w-[11px]",
            GUIDE_COLOR,
          )}
        />
      )}
    </span>
  );
}

function RowActionButton({
  icon: Icon,
  label,
  title,
  danger,
  dimmed,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  danger?: boolean;
  dimmed?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-[26px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        danger && "hover:bg-destructive/12 hover:text-destructive",
        dimmed && "opacity-30",
      )}
    >
      <Icon className="size-[15px]" />
    </button>
  );
}

function TreeRowView({
  row,
  selected,
  onSelect,
  onToggle,
  onAddChild,
  onRename,
  onMove,
  onDelete,
}: {
  row: TreeRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (unit: OrgUnitResponse) => void;
  onRename: (unit: OrgUnitResponse) => void;
  onMove: (unit: OrgUnitResponse) => void;
  onDelete: (unit: OrgUnitResponse) => void;
}) {
  const { unit, depth, guides, hasChildren, open, isRoot, isFirst } = row;
  const TypeIcon = ORG_UNIT_TYPE_META[unit.type].icon;

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-level={depth + 1}
      aria-expanded={hasChildren ? open : undefined}
      // Overrides accname's default "name from content" for this row — the
      // row's text content also includes the hover-only action buttons'
      // labels, which would otherwise leak into its computed name.
      aria-label={unit.name}
      data-testid={`org-unit-row-${unit.id}`}
      tabIndex={0}
      onClick={() => onSelect(unit.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(unit.id);
        }
      }}
      className={cn(
        "group/row relative flex h-[34px] cursor-pointer items-center rounded-md pr-1.5 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected && "bg-accent shadow-[inset_0_0_0_1px_var(--border)]",
        isRoot && !isFirst && "mt-2",
      )}
    >
      {guides.map((kind, i) => (
        // eslint-disable-next-line react/no-array-index-key -- guide columns are positional, stable per row
        <TreeGuide key={i} kind={kind} />
      ))}

      {hasChildren ? (
        <button
          type="button"
          aria-label={open ? `Collapse ${unit.name}` : `Expand ${unit.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(unit.id);
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ChevronRightIcon
            className={cn(
              "size-[15px] transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span aria-hidden className="size-5 shrink-0" />
      )}

      <span
        className={cn(
          "mx-1.5 flex shrink-0 items-center text-muted-foreground",
          isRoot && "text-foreground",
        )}
      >
        <TypeIcon className="size-4" />
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          isRoot && "text-[0.9rem] font-semibold",
        )}
      >
        {unit.name}
      </span>

      <span className="relative flex h-full min-w-[104px] shrink-0 items-center justify-end">
        <span className="flex items-center gap-1.5 transition-opacity group-hover/row:opacity-0">
          {unit.directRole && (
            <span
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-[0.65rem] capitalize text-muted-foreground",
                unit.directRole === "owner" &&
                  "border-foreground/30 text-foreground",
              )}
            >
              {ROLE_LABEL[unit.directRole]}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <UsersIcon className="size-[13px]" />
            {unit.memberCount}
          </span>
        </span>

        <span className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-px opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          <RowActionButton
            icon={FolderPlusIcon}
            label={`Add child unit to ${unit.name}`}
            title="Add child unit"
            onClick={(e) => {
              e.stopPropagation();
              onAddChild(unit);
            }}
          />
          <RowActionButton
            icon={PencilIcon}
            label={`Rename ${unit.name}`}
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              onRename(unit);
            }}
          />
          <RowActionButton
            icon={MoveIcon}
            label={`Move ${unit.name}`}
            title="Move"
            onClick={(e) => {
              e.stopPropagation();
              onMove(unit);
            }}
          />
          <RowActionButton
            icon={TrashIcon}
            danger
            dimmed={hasChildren}
            label={`Delete ${unit.name}`}
            title={hasChildren ? "Delete its child units first" : "Delete"}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(unit);
            }}
          />
        </span>
      </span>
    </div>
  );
}

/**
 * The real connector/chevron/type-icon tree (admin-area-org-tree change,
 * tasks.md sections 3–4) — supersedes the old flat-indented PORT. Owns all
 * tree-local state itself (selection, expand/collapse, every row dialog),
 * matching how the design's Component owns it in one place.
 */
export function OrgUnitsTree({ units }: { units: OrgUnitResponse[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [createRootOpen, setCreateRootOpen] = useState(false);
  const [createChildFor, setCreateChildFor] = useState<OrgUnitResponse | null>(
    null,
  );
  const [renaming, setRenaming] = useState<OrgUnitResponse | null>(null);
  const [moving, setMoving] = useState<OrgUnitResponse | null>(null);
  const [deleting, setDeleting] = useState<OrgUnitResponse | null>(null);
  const [deleteBlockedFor, setDeleteBlockedFor] =
    useState<OrgUnitResponse | null>(null);

  const unitsById = useMemo(
    () => new Map(units.map((unit) => [unit.id, unit])),
    [units],
  );
  const rows = useMemo(() => buildRows(units, collapsed), [units, collapsed]);
  const collapsibleIds = useMemo(() => collapsibleUnitIds(units), [units]);
  const anyOpen = collapsibleIds.some((id) => !collapsed[id]);
  const hasUnits = units.length > 0;

  const selected = selectedId ? (unitsById.get(selectedId) ?? null) : null;

  const toggleRow = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleAll = () => {
    if (anyOpen) {
      setCollapsed(Object.fromEntries(collapsibleIds.map((id) => [id, true])));
    } else {
      setCollapsed({});
    }
  };

  const childCountOf = (unitId: string) =>
    units.filter((u) => u.parentId === unitId).length;

  const openDelete = (unit: OrgUnitResponse) => {
    // Pre-emptive leaf-first invariant (D4/task 4.1) — never sends a
    // request that would 4xx; the non-leaf case is a pure client decision.
    if (childCountOf(unit.id) > 0) setDeleteBlockedFor(unit);
    else setDeleting(unit);
  };

  return (
    <Card className="overflow-hidden py-0">
      {/* CardHeader is a CSS grid (1fr auto once a CardAction child is
       * present) — the title block auto-places into col 1/row 1 and
       * CardAction is already pinned to col 2 spanning both rows, so no
       * `flex` override is needed for the side-by-side layout; `items-center`
       * replaces the base `items-start` (meant for stacked title+description)
       * since this header's content is a single short row. */}
      <CardHeader className="items-center gap-2 border-b py-4">
        <div className="flex items-center gap-2">
          <CardTitle>Organization units</CardTitle>
          <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {units.length} {units.length === 1 ? "unit" : "units"}
          </span>
        </div>
        <CardAction className="flex items-center gap-2">
          {hasUnits && (
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {anyOpen ? "Collapse all" : "Expand all"}
            </Button>
          )}
          {/* Gating seam (D5.1/#158): create-root is open to every user by
           * today's server policy (self-hosted bootstrap) — this affordance
           * is deliberately NOT gated by any client-side "is admin" check.
           * When the instance-level `root_org_creation` signal (#158)
           * lands, it gates this button from server-sourced data; until
           * then it stays plainly available. */}
          <Button size="sm" onClick={() => setCreateRootOpen(true)}>
            <PlusIcon />
            New organization
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="px-3 py-2">
        {hasUnits ? (
          <>
            <div
              role="tree"
              aria-label="Organization units"
              className="flex flex-col py-0.5"
            >
              {rows.map((row) => (
                <TreeRowView
                  key={row.unit.id}
                  row={row}
                  selected={row.unit.id === selectedId}
                  onSelect={setSelectedId}
                  onToggle={toggleRow}
                  onAddChild={(unit) => {
                    // Expand the parent so the newly-created child is visible.
                    setCollapsed((prev) => ({ ...prev, [unit.id]: false }));
                    setCreateChildFor(unit);
                  }}
                  onRename={setRenaming}
                  onMove={setMoving}
                  onDelete={openDelete}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 px-1">
              {ORG_UNIT_TYPE_ORDER.map((type) => {
                const meta = ORG_UNIT_TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <span
                    key={type}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Icon className="size-3.5 text-foreground/55" />
                    {meta.label}
                  </span>
                );
              })}
            </div>
          </>
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="mb-1.5 text-[0.95rem] font-semibold">
              No organizations yet
            </p>
            <p className="mx-auto mb-4 max-w-[40ch] text-[0.84rem] text-muted-foreground">
              An organization is the top-level container for your teams, chats,
              and members. Create one to start sharing.
            </p>
            <Button className="mx-auto" onClick={() => setCreateRootOpen(true)}>
              <PlusIcon />
              Create organization
            </Button>
          </div>
        )}
      </CardContent>

      {selected &&
        (() => {
          const chain = visibleAncestorChain(selected, unitsById);
          const breadcrumb = chain.map((u) => u.name).join(" › ");
          const eff = effectiveRoleFor(selected, unitsById);
          const roleText = eff
            ? eff.inherited
              ? `Your role here: ${ROLE_LABEL[eff.role]} · inherited from ${eff.via.name}`
              : `Your role here: ${ROLE_LABEL[eff.role]} · direct`
            : "You have no direct role on this unit.";
          const SelectedTypeIcon = ORG_UNIT_TYPE_META[selected.type].icon;

          return (
            <CardFooter className="flex flex-wrap items-center gap-3 border-t bg-muted/45 py-3">
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                <SelectedTypeIcon className="size-[15px] shrink-0 text-muted-foreground" />
                <span className="truncate">{breadcrumb}</span>
              </span>
              <span className="text-sm text-muted-foreground">{roleText}</span>
              <Button
                variant="outline"
                size="sm"
                disabled
                title="Members panel is the next step — deferred to the fast-follow change (D7)."
                className="ml-auto shrink-0 opacity-55"
              >
                <UsersIcon />
                Manage members
              </Button>
            </CardFooter>
          );
        })()}

      <CreateOrgUnitDialog
        open={createRootOpen}
        onOpenChange={setCreateRootOpen}
      />
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
      {deleteBlockedFor && (
        <DeleteBlockedOrgUnitDialog
          unit={deleteBlockedFor}
          childCount={childCountOf(deleteBlockedFor.id)}
          open
          onOpenChange={(open) => !open && setDeleteBlockedFor(null)}
        />
      )}
    </Card>
  );
}
