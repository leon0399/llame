"use client";

import { useMemo, useState } from "react";
import { PlusIcon, UsersIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";

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
} from "./org-tree-utils";
import { TreeRowView } from "./org-tree-row";

/** Selection, expand/collapse, and the derived row list — the tree's
 *  navigation state, independent of which dialog (if any) is open. */
function useOrgTreeNavigation(units: Array<OrgUnitResponse>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const unitsById = useMemo(
    () => new Map(units.map((unit) => [unit.id, unit])),
    [units],
  );
  const rows = useMemo(() => buildRows(units, collapsed), [units, collapsed]);
  const collapsibleIds = useMemo(() => collapsibleUnitIds(units), [units]);
  const anyOpen = collapsibleIds.some((id) => !collapsed[id]);

  // The design always has a selection (its mock preselects a unit), so the
  // selected-unit footer is visible from first paint: fall back to the first
  // rendered row when nothing is selected yet — also covers the selected
  // unit being deleted (selection moves to the first root, footer stays).
  const selected =
    (selectedId ? unitsById.get(selectedId) : undefined) ??
    rows[0]?.unit ??
    null;

  const toggleRow = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const openRow = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: false }));

  const toggleAll = () => {
    if (anyOpen) {
      setCollapsed(Object.fromEntries(collapsibleIds.map((id) => [id, true])));
    } else {
      setCollapsed({});
    }
  };

  const childCountOf = (unitId: string) =>
    units.filter((u) => u.parentId === unitId).length;

  return {
    unitsById,
    rows,
    anyOpen,
    selected,
    setSelectedId,
    toggleRow,
    toggleAll,
    openRow,
    childCountOf,
  };
}

/** The row/create/rename/move/delete dialog state — one owner in charge of
 *  every unit dialog, the way the design's Component owns it in one place. */
function useOrgUnitDialogs(childCountOf: (unitId: string) => number) {
  const [createRootOpen, setCreateRootOpen] = useState(false);
  const [createChildFor, setCreateChildFor] = useState<OrgUnitResponse | null>(
    null,
  );
  const [renaming, setRenaming] = useState<OrgUnitResponse | null>(null);
  const [moving, setMoving] = useState<OrgUnitResponse | null>(null);
  const [deleting, setDeleting] = useState<OrgUnitResponse | null>(null);
  const [deleteBlockedFor, setDeleteBlockedFor] =
    useState<OrgUnitResponse | null>(null);

  const openDelete = (unit: OrgUnitResponse) => {
    // Pre-emptive leaf-first invariant (D4/task 4.1) — never sends a
    // request that would 4xx; the non-leaf case is a pure client decision.
    if (childCountOf(unit.id) > 0) setDeleteBlockedFor(unit);
    else setDeleting(unit);
  };

  return {
    createRootOpen,
    setCreateRootOpen,
    createChildFor,
    setCreateChildFor,
    renaming,
    setRenaming,
    moving,
    setMoving,
    deleting,
    setDeleting,
    deleteBlockedFor,
    setDeleteBlockedFor,
    openDelete,
  };
}

type OrgUnitDialogsBundle = ReturnType<typeof useOrgUnitDialogs>;
type OrgTreeNavigationBundle = ReturnType<typeof useOrgTreeNavigation>;

/** The tree body itself — rows plus the type legend — a distinct concern
 *  from the card shell (toolbar/footer/dialogs) around it. */
function OrgTreeRowList({
  nav,
  dialogs,
}: {
  nav: OrgTreeNavigationBundle;
  dialogs: OrgUnitDialogsBundle;
}) {
  return (
    <>
      <div
        role="tree"
        aria-label="Organization units"
        className="flex flex-col py-[0.15rem]"
      >
        {nav.rows.map((row) => (
          <TreeRowView
            key={row.unit.id}
            row={row}
            selected={row.unit.id === nav.selected?.id}
            onSelect={nav.setSelectedId}
            onToggle={nav.toggleRow}
            actions={{
              onAddChild: (unit) => {
                // Expand the parent so the newly-created child is visible.
                nav.openRow(unit.id);
                dialogs.setCreateChildFor(unit);
              },
              onRename: dialogs.setRenaming,
              onMove: dialogs.setMoving,
              onDelete: dialogs.openDelete,
            }}
          />
        ))}
      </div>

      <OrgUnitTypeLegend />
    </>
  );
}

/** The two unit-creation dialogs (root and child) — a distinct concern from
 *  mutating/removing an existing unit, below. */
function OrgUnitCreateDialogs({ dialogs }: { dialogs: OrgUnitDialogsBundle }) {
  return (
    <>
      <CreateOrgUnitDialog
        open={dialogs.createRootOpen}
        onOpenChange={dialogs.setCreateRootOpen}
      />
      {dialogs.createChildFor && (
        <CreateOrgUnitDialog
          parent={dialogs.createChildFor}
          open
          onOpenChange={(open) => !open && dialogs.setCreateChildFor(null)}
        />
      )}
    </>
  );
}

/** The delete flow's two mutually-exclusive dialog variants — plain delete,
 *  or the blocked-by-children explainer — as one unit distinct from the
 *  single-field rename/move mutations below. */
function OrgUnitDeleteDialogs({
  dialogs,
  childCountOf,
}: {
  dialogs: OrgUnitDialogsBundle;
  childCountOf: (unitId: string) => number;
}) {
  return (
    <>
      {dialogs.deleting && (
        <DeleteOrgUnitDialog
          unit={dialogs.deleting}
          open
          onOpenChange={(open) => !open && dialogs.setDeleting(null)}
        />
      )}
      {dialogs.deleteBlockedFor && (
        <DeleteBlockedOrgUnitDialog
          unit={dialogs.deleteBlockedFor}
          childCount={childCountOf(dialogs.deleteBlockedFor.id)}
          open
          onOpenChange={(open) => !open && dialogs.setDeleteBlockedFor(null)}
        />
      )}
    </>
  );
}

/** Rename/move/delete — every dialog that acts on an already-existing unit,
 *  as opposed to creating a new one above. */
function OrgUnitMutationDialogs({
  units,
  dialogs,
  childCountOf,
}: {
  units: Array<OrgUnitResponse>;
  dialogs: OrgUnitDialogsBundle;
  childCountOf: (unitId: string) => number;
}) {
  return (
    <>
      {dialogs.renaming && (
        <RenameOrgUnitDialog
          unit={dialogs.renaming}
          open
          onOpenChange={(open) => !open && dialogs.setRenaming(null)}
        />
      )}
      {dialogs.moving && (
        <MoveOrgUnitDialog
          unit={dialogs.moving}
          units={units}
          open
          onOpenChange={(open) => !open && dialogs.setMoving(null)}
        />
      )}
      <OrgUnitDeleteDialogs dialogs={dialogs} childCountOf={childCountOf} />
    </>
  );
}

function OrgUnitDialogs({
  units,
  dialogs,
  childCountOf,
}: {
  units: Array<OrgUnitResponse>;
  dialogs: OrgUnitDialogsBundle;
  childCountOf: (unitId: string) => number;
}) {
  return (
    <>
      <OrgUnitCreateDialogs dialogs={dialogs} />
      <OrgUnitMutationDialogs
        units={units}
        dialogs={dialogs}
        childCountOf={childCountOf}
      />
    </>
  );
}

/** Isolated from the toolbar around it because its gating is a live, evolving
 *  concern (D5.1/#158), not fixed toolbar layout — future work touches only
 *  this component. */
function CreateOrgUnitButton({ onCreateRoot }: { onCreateRoot: () => void }) {
  return (
    // Gating seam (D5.1/#158): create-root is open to every user by today's
    // server policy (self-hosted bootstrap) — this affordance is
    // deliberately NOT gated by any client-side "is admin" check. When the
    // instance-level `root_org_creation` signal (#158) lands, it gates this
    // button from server-sourced data; until then it stays plainly
    // available.
    <Button
      size="sm"
      className="gap-[0.4rem] text-[0.8rem]"
      onClick={onCreateRoot}
    >
      <PlusIcon />
      New organization
    </Button>
  );
}

function OrgTreeToolbar({
  unitCount,
  anyOpen,
  onToggleAll,
  onCreateRoot,
}: {
  unitCount: number;
  anyOpen: boolean;
  onToggleAll: () => void;
  onCreateRoot: () => void;
}) {
  return (
    <CardHeader className="flex flex-row items-center gap-[0.55rem] border-b px-4 pt-[0.9rem] pb-[0.9rem]!">
      <div className="flex items-center gap-[0.55rem]">
        <CardTitle className="text-[0.9rem]">Organization units</CardTitle>
        <span className="rounded-md bg-secondary px-[0.45rem] py-[0.05rem] text-[0.72rem] text-muted-foreground">
          {unitCount} {unitCount === 1 ? "unit" : "units"}
        </span>
      </div>
      <CardAction className="ml-auto flex items-center gap-[0.4rem] self-center">
        {unitCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-[0.4rem] text-[0.8rem]"
            onClick={onToggleAll}
          >
            {anyOpen ? "Collapse all" : "Expand all"}
          </Button>
        )}
        <CreateOrgUnitButton onCreateRoot={onCreateRoot} />
      </CardAction>
    </CardHeader>
  );
}

function OrgUnitTypeLegend() {
  return (
    <div className="mt-[0.95rem] flex flex-wrap gap-x-[0.95rem] gap-y-[0.35rem] px-[0.35rem]">
      {ORG_UNIT_TYPE_ORDER.map((type) => {
        const meta = ORG_UNIT_TYPE_META[type];
        const Icon = meta.icon;
        return (
          <span
            key={type}
            className="flex items-center gap-[0.35rem] text-[0.73rem] text-muted-foreground"
          >
            <Icon className="size-3.5 text-foreground/55" />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function OrgTreeEmptyState({ onCreateRoot }: { onCreateRoot: () => void }) {
  return (
    <div className="px-4 py-[2.6rem] text-center">
      <p className="mb-[0.35rem] text-[0.95rem] font-semibold">
        No organizations yet
      </p>
      <p className="mx-auto mb-[1.1rem] max-w-[40ch] text-[0.84rem] leading-normal text-muted-foreground">
        An organization is the top-level container for your teams, chats, and
        members. Create one to start sharing.
      </p>
      <Button
        size="sm"
        className="mx-auto gap-[0.4rem] text-[0.8rem]"
        onClick={onCreateRoot}
      >
        <PlusIcon />
        Create organization
      </Button>
    </div>
  );
}

/** Isolated from the footer around it because its disabled state is a live,
 *  evolving concern (deferred to D7), not fixed footer layout — the D7
 *  fast-follow touches only this component. */
function ManageMembersButton() {
  return (
    // Button's disabled:pointer-events-none suppresses the native title
    // tooltip — the explanation rides a wrapping span.
    <span
      className="ml-auto shrink-0"
      title="Members panel is the next step — deferred to the fast-follow change (D7)."
    >
      <Button
        variant="outline"
        size="sm"
        disabled
        className="gap-[0.4rem] text-[0.8rem] opacity-55"
      >
        <UsersIcon />
        Manage members
      </Button>
    </span>
  );
}

function OrgTreeSelectedFooter({
  selected,
  unitsById,
}: {
  selected: OrgUnitResponse;
  unitsById: Map<string, OrgUnitResponse>;
}) {
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
    <CardFooter className="flex flex-wrap items-center gap-[0.85rem] border-t bg-muted/45 px-4 pt-[0.7rem]! pb-[0.7rem]">
      <span className="flex min-w-0 items-center gap-[0.4rem] text-[0.82rem]">
        <SelectedTypeIcon className="size-[15px] shrink-0 text-muted-foreground" />
        <span className="truncate">{breadcrumb}</span>
      </span>
      <span className="text-xs text-muted-foreground">{roleText}</span>
      <ManageMembersButton />
    </CardFooter>
  );
}

/**
 * The real connector/chevron/type-icon tree (admin-area-org-tree change,
 * tasks.md sections 3–4) — supersedes the old flat-indented PORT. Owns all
 * tree-local state itself (selection, expand/collapse, every row dialog),
 * matching how the design's Component owns it in one place.
 */
export function OrgUnitsTree({ units }: { units: Array<OrgUnitResponse> }) {
  const nav = useOrgTreeNavigation(units);
  const dialogs = useOrgUnitDialogs(nav.childCountOf);
  const hasUnits = units.length > 0;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      {/* Flex override of CardHeader's base grid: the grid's title track is
       * `auto-rows-min` (text-height, top-pinned) while the row-spanning
       * CardAction stretches the container to button height — `items-center`
       * only centers items within tracks, so the title rides high. This
       * header is a single row (mock .adm-card-head), so flex centers it.
       * CardAction's grid placement classes are inert under flex, but its
       * `self-start` isn't — hence self-center + ml-auto. */}
      <OrgTreeToolbar
        unitCount={units.length}
        anyOpen={nav.anyOpen}
        onToggleAll={nav.toggleAll}
        onCreateRoot={() => dialogs.setCreateRootOpen(true)}
      />

      <CardContent className="px-[0.6rem] py-[0.55rem]">
        {hasUnits ? (
          <OrgTreeRowList nav={nav} dialogs={dialogs} />
        ) : (
          <OrgTreeEmptyState
            onCreateRoot={() => dialogs.setCreateRootOpen(true)}
          />
        )}
      </CardContent>

      {nav.selected && (
        <OrgTreeSelectedFooter
          selected={nav.selected}
          unitsById={nav.unitsById}
        />
      )}

      <OrgUnitDialogs
        units={units}
        dialogs={dialogs}
        childCountOf={nav.childCountOf}
      />
    </Card>
  );
}
