"use client";

import { Building2Icon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { DialogFooter } from "@workspace/ui/components/dialog";
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

/** The Cancel + primary-action footer every org-unit `Dialog` (create,
 *  rename, move) shares — `DeleteOrgUnitDialog`'s `AlertDialog` and
 *  `DeleteBlockedOrgUnitDialog`'s single-button footer are different shapes
 *  and stay local to those components. */
export function OrgDialogFooter({
  onCancel,
  onSubmit,
  submitLabel,
  submitDisabled,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled: boolean;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" className="text-[0.86rem]" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        className="text-[0.86rem]"
        onClick={onSubmit}
        disabled={submitDisabled}
      >
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

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
      <legend className="text-[0.8rem] font-medium">Type</legend>
      <div className="grid grid-cols-3 gap-[0.35rem]">
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
                "flex flex-col items-center gap-[0.3rem] rounded-md border px-[0.3rem] py-[0.55rem] text-[0.71rem] text-muted-foreground transition-colors hover:bg-accent",
                selected && "border-foreground/35 bg-accent text-foreground",
              )}
            >
              <Icon className="size-[17px]" />
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
        "flex items-center gap-2 rounded-sm px-2 py-[0.42rem] text-left text-[0.84rem] hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <Building2Icon className="size-[15px] shrink-0 text-muted-foreground" />—
      Make root organization —
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
      style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}
      className={cn(
        "flex items-center gap-2 truncate rounded-sm py-[0.42rem] pr-2 text-left text-[0.84rem] hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <Icon className="size-[15px] shrink-0 text-muted-foreground" />
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
