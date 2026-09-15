"use client";

import type { CSSProperties } from "react";

import { Building2Icon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import type {
  OrgUnitResponse,
  OrgUnitType,
} from "@/lib/services/org-units/types";

import {
  CHILD_ORG_UNIT_TYPES,
  ORG_UNIT_TYPE_META,
  visibleAncestorChain,
} from "./org-tree-utils";

/**
 * Shared building blocks for org-unit-dialogs.tsx's Create/Rename/Move
 * dialogs — split into their own file once that file's total line count
 * outgrew the project's 500-line cap. Not exported beyond this pair of
 * files; keep additions here scoped to genuinely shared dialog pieces.
 */

/** The child-unit type grid — only shown when creating under a parent
 *  (a root organization has no type). Split out from `CreateOrgUnitDialog`
 *  as its own self-contained control. */
export function OrgUnitTypePicker({
  type,
  onTypeChange,
}: {
  type: OrgUnitType;
  onTypeChange: (type: OrgUnitType) => void;
}) {
  return (
    <fieldset className="m-0 space-y-2 border-0 p-0">
      <legend className="text-xs font-medium">Type</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {CHILD_ORG_UNIT_TYPES.map((candidateType) => {
          const meta = ORG_UNIT_TYPE_META[candidateType];
          const Icon = meta.icon;
          const selected = type === candidateType;
          return (
            <button
              key={candidateType}
              type="button"
              aria-pressed={selected}
              onClick={() => onTypeChange(candidateType)}
              className={cn(
                "flex flex-col items-center gap-1.25 rounded-md border px-1.25 py-2.25 text-xs text-muted-foreground transition-colors hover:bg-accent",
                selected && "border-foreground/35 bg-accent text-foreground",
              )}
            >
              <Icon className="size-4.25" />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function MoveRootOption({
  selected,
  onSelect,
}: {
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see comment on the listbox container in MoveTargetList
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 rounded-sm px-2 py-1.75 text-left text-sm hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <Building2Icon className="size-3.75 shrink-0" />— Make root organization —
    </button>
  );
}

function MoveCandidateOption({
  candidate,
  depth,
  selected,
  onSelect,
}: {
  candidate: OrgUnitResponse;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = ORG_UNIT_TYPE_META[candidate.type].icon;
  return (
    <button
      type="button"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see comment on the listbox container in MoveTargetList
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      style={
        // SAFETY: `--row-indent` is a CSS custom property the
        // `pl-(--row-indent)` class below reads; React's `CSSProperties` type
        // has no way to name a custom property, so widening to accept an
        // arbitrary key is the only way to pass it through inline `style`.
        { "--row-indent": `${0.5 + depth * 0.85}rem` } as CSSProperties
      }
      className={cn(
        "flex items-center gap-2 truncate rounded-sm py-1.75 pr-2 pl-(--row-indent) text-left text-sm hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <Icon className="size-3.75 shrink-0" />
      <span className="truncate">{candidate.name}</span>
    </button>
  );
}

/** The parent-picker listbox — split out from `MoveOrgUnitDialog` as its own
 *  self-contained control. Custom picker, not a native `<select>`: rows need
 *  icon + depth-indented truncated names that `<option>` can't render.
 *  role=listbox/option with aria-selected is the correct ARIA pattern for
 *  this shape. */
export function MoveTargetList({
  candidates,
  unitsById,
  parentId,
  onParentIdChange,
}: {
  candidates: Array<OrgUnitResponse>;
  unitsById: Map<string, OrgUnitResponse>;
  parentId: string | null;
  onParentIdChange: (parentId: string | null) => void;
}) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see comment above
      role="listbox"
      aria-label="New parent"
      className="flex max-h-60 flex-col gap-px overflow-y-auto rounded-md border p-1"
    >
      <MoveRootOption
        selected={parentId === null}
        onSelect={() => onParentIdChange(null)}
      />
      {candidates.map((candidate) => (
        <MoveCandidateOption
          key={candidate.id}
          candidate={candidate}
          depth={visibleAncestorChain(candidate, unitsById).length - 1}
          selected={parentId === candidate.id}
          onSelect={() => onParentIdChange(candidate.id)}
        />
      ))}
    </div>
  );
}
