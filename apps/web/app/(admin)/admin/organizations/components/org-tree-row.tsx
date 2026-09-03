import {
  ChevronRightIcon,
  FolderPlusIcon,
  MoveIcon,
  PencilIcon,
  TrashIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import type { OrgUnitResponse } from "@/lib/services/org-units/types";

import {
  ORG_UNIT_TYPE_META,
  ROLE_LABEL,
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

type RowActionButtonProps = {
  icon: LucideIcon;
  label: string;
  title: string;
  danger?: boolean;
  dimmed?: boolean;
  onClick: () => void;
};

function RowActionButton({
  icon: Icon,
  label,
  title,
  danger,
  dimmed,
  onClick,
}: RowActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      // Every row action lives inside the clickable row, so stopping
      // propagation here (not at each call site) is what keeps a click on
      // any of them from also selecting the row.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-[26px] shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        danger && "hover:bg-destructive/12 hover:text-destructive",
        dimmed && "opacity-[0.32]",
      )}
    >
      <Icon className="size-[15px]" />
    </button>
  );
}

function TreeRowExpander({
  hasChildren,
  open,
  unitName,
  onToggle,
}: {
  hasChildren: boolean;
  open: boolean;
  unitName: string;
  onToggle: () => void;
}) {
  if (!hasChildren) {
    return <span aria-hidden className="size-5 shrink-0" />;
  }
  return (
    <button
      type="button"
      aria-label={open ? `Collapse ${unitName}` : `Expand ${unitName}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <ChevronRightIcon
        className={cn("size-[15px] transition-transform", open && "rotate-90")}
      />
    </button>
  );
}

/** The role badge + member-count meta, hidden on hover in favor of actions. */
function TreeRowMeta({ unit }: { unit: OrgUnitResponse }) {
  return (
    <span className="flex items-center gap-[0.45rem] transition-opacity group-focus-within/row:opacity-0 group-hover/row:opacity-0">
      {unit.directRole && (
        <span
          className={cn(
            "rounded-sm border px-[0.38rem] py-[0.06rem] text-[0.65rem] capitalize text-muted-foreground",
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
  );
}

export type TreeRowActionHandlers = {
  onAddChild: (unit: OrgUnitResponse) => void;
  onRename: (unit: OrgUnitResponse) => void;
  onMove: (unit: OrgUnitResponse) => void;
  onDelete: (unit: OrgUnitResponse) => void;
};

type TreeRowActionsProps = TreeRowActionHandlers & {
  unit: OrgUnitResponse;
  hasChildren: boolean;
};

function rowActions({
  unit,
  hasChildren,
  onAddChild,
  onRename,
  onMove,
  onDelete,
}: TreeRowActionsProps): Array<RowActionButtonProps> {
  return [
    {
      icon: FolderPlusIcon,
      label: `Add child unit to ${unit.name}`,
      title: "Add child unit",
      onClick: () => onAddChild(unit),
    },
    {
      icon: PencilIcon,
      label: `Rename ${unit.name}`,
      title: "Rename",
      onClick: () => onRename(unit),
    },
    {
      icon: MoveIcon,
      label: `Move ${unit.name}`,
      title: "Move",
      onClick: () => onMove(unit),
    },
    {
      icon: TrashIcon,
      danger: true,
      dimmed: hasChildren,
      label: `Delete ${unit.name}`,
      title: hasChildren ? "Delete its child units first" : "Delete",
      onClick: () => onDelete(unit),
    },
  ];
}

/** Add/rename/move/delete — revealed over the meta on hover or focus. */
function TreeRowActions(props: TreeRowActionsProps) {
  return (
    <span className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-px opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
      {rowActions(props).map((action) => (
        <RowActionButton key={action.title} {...action} />
      ))}
    </span>
  );
}

type TreeRowTrailingProps = TreeRowActionHandlers & {
  unit: OrgUnitResponse;
  hasChildren: boolean;
};

/** The row's trailing area: role/member-count meta, swapped for actions on
 *  hover — the actions absolutely overlay the meta rather than pushing the
 *  row width around when they reveal. */
function TreeRowTrailing({
  unit,
  hasChildren,
  onAddChild,
  onRename,
  onMove,
  onDelete,
}: TreeRowTrailingProps) {
  return (
    <span className="relative flex h-full min-w-[104px] shrink-0 items-center justify-end">
      {/* Hide/reveal must mirror the actions' triggers exactly (hover AND
          focus-within) — a selected row keeps focus, and an unmirrored
          trigger leaves the meta visible under the revealed actions. */}
      <TreeRowMeta unit={unit} />
      <TreeRowActions
        unit={unit}
        hasChildren={hasChildren}
        onAddChild={onAddChild}
        onRename={onRename}
        onMove={onMove}
        onDelete={onDelete}
      />
    </span>
  );
}

/** The type icon + truncated name — the row's own identity, ahead of the
 *  trailing meta/actions. */
function TreeRowLabel({
  unit,
  isRoot,
}: {
  unit: TreeRow["unit"];
  isRoot: boolean;
}) {
  const TypeIcon = ORG_UNIT_TYPE_META[unit.type].icon;
  return (
    <>
      <span
        className={cn(
          "ml-[0.1rem] mr-[0.5rem] flex shrink-0 items-center text-muted-foreground",
          isRoot && "text-foreground",
        )}
      >
        <TypeIcon className="size-4" />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[0.86rem]",
          isRoot && "text-[0.9rem] font-semibold",
        )}
      >
        {unit.name}
      </span>
    </>
  );
}

type TreeRowViewProps = {
  row: TreeRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  actions: TreeRowActionHandlers;
};

/** Only the ROW itself being focused should treat Enter/Space as select:
 *  keydown bubbles from the chevron/action buttons too, and an unguarded
 *  preventDefault would cancel their native activation and hijack it. */
function handleRowKeyDown(
  e: React.KeyboardEvent<HTMLDivElement>,
  unitId: string,
  onSelect: (id: string) => void,
) {
  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    onSelect(unitId);
  }
}

/** The connector guides plus the expand/collapse chevron ahead of a row's
 *  own icon+name — together, the row's indentation and hierarchy controls. */
function TreeRowLeading({
  guides,
  hasChildren,
  open,
  unitName,
  onToggle,
}: {
  guides: Array<GuideKind>;
  hasChildren: boolean;
  open: boolean;
  unitName: string;
  onToggle: () => void;
}) {
  return (
    <>
      {guides.map((kind, i) => (
        <TreeGuide key={i} kind={kind} />
      ))}
      <TreeRowExpander
        hasChildren={hasChildren}
        open={open}
        unitName={unitName}
        onToggle={onToggle}
      />
    </>
  );
}

function treeRowClassName(
  selected: boolean,
  isRoot: boolean,
  isFirst: boolean,
): string {
  return cn(
    "group/row relative flex h-[34px] cursor-pointer items-center rounded-md pr-[0.4rem] transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    selected && "bg-accent shadow-[inset_0_0_0_1px_var(--border)]",
    isRoot && !isFirst && "mt-2",
  );
}

export function TreeRowView({
  row,
  selected,
  onSelect,
  onToggle,
  actions,
}: TreeRowViewProps) {
  const { unit, depth, guides, hasChildren, open, isRoot, isFirst } = row;

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
      onKeyDown={(e) => handleRowKeyDown(e, unit.id, onSelect)}
      className={treeRowClassName(selected, isRoot, isFirst)}
    >
      <TreeRowLeading
        guides={guides}
        hasChildren={hasChildren}
        open={open}
        unitName={unit.name}
        onToggle={() => onToggle(unit.id)}
      />
      <TreeRowLabel unit={unit} isRoot={isRoot} />
      <TreeRowTrailing unit={unit} hasChildren={hasChildren} {...actions} />
    </div>
  );
}
