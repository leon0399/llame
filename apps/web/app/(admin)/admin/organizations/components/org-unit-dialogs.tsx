"use client";

import { useMemo, useState } from "react";
import { Building2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";

import {
  useCreateChildOrg,
  useCreateRootOrg,
  useDeleteOrgUnit,
  useUpdateOrgUnit,
} from "@/lib/services/org-units/mutations";
import type {
  OrgUnitResponse,
  OrgUnitType,
} from "@/lib/services/org-units/types";

import { ApiErrorMessage } from "./api-error-message";
import {
  CHILD_ORG_UNIT_TYPES,
  descendantIdsOf,
  ORG_UNIT_TYPE_META,
  visibleAncestorChain,
} from "./org-tree-utils";

const DEFAULT_CHILD_TYPE: OrgUnitType = "group";

/**
 * Create a root organization (no `parent`) or a child unit under it
 * (`parent` set) — same form either way (org-admin-ui spec's "create-child"
 * and "create root" are both a name-only POST).
 */
export function CreateOrgUnitDialog({
  parent,
  open,
  onOpenChange,
}: {
  parent?: OrgUnitResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<OrgUnitType>(DEFAULT_CHILD_TYPE);
  const createRoot = useCreateRootOrg();
  const createChild = useCreateChildOrg();
  const mutation = parent ? createChild : createRoot;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const onSuccess = () => {
      setName("");
      setType(DEFAULT_CHILD_TYPE);
      onOpenChange(false);
    };
    if (parent) {
      createChild.mutate(
        { parentId: parent.id, name: trimmed, type },
        { onSuccess },
      );
    } else {
      createRoot.mutate({ name: trimmed }, { onSuccess });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          setType(DEFAULT_CHILD_TYPE);
        }
        // Clear a previous attempt's error so reopening doesn't flash stale
        // copy before this attempt has even run.
        if (next) mutation.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {parent ? `New unit under “${parent.name}”` : "New organization"}
          </DialogTitle>
          <DialogDescription>
            {parent
              ? "Create a child unit nested under this one. Members and roles inherit down from the parent."
              : "An organization is the top-level container for your teams, chats, and members."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="org-unit-name">Name</Label>
          <Input
            id="org-unit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            autoFocus
          />
        </div>
        {parent && (
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {CHILD_ORG_UNIT_TYPES.map((candidateType) => {
                const meta = ORG_UNIT_TYPE_META[candidateType];
                const Icon = meta.icon;
                const selected = type === candidateType;
                return (
                  <button
                    key={candidateType}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setType(candidateType)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 text-[0.71rem] text-muted-foreground transition-colors hover:bg-accent",
                      selected &&
                        "border-foreground/35 bg-accent text-foreground",
                    )}
                  >
                    <Icon className="size-[17px]" />
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <ApiErrorMessage error={mutation.error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || mutation.isPending}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameOrgUnitDialog({
  unit,
  open,
  onOpenChange,
}: {
  unit: OrgUnitResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(unit.name);
  const update = useUpdateOrgUnit();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === unit.name) {
      onOpenChange(false);
      return;
    }
    update.mutate(
      { orgUnitId: unit.id, name: trimmed },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename “{unit.name}”</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="Name"
          autoFocus
        />
        <ApiErrorMessage error={update.error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || update.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Parent picker limited to loaded/visible units + a "make root" option
 * (D4/task 4.2), NOT a client-side "units I administer" filter — the server
 * is the authority on whether a given move is legal (admin-tier on both
 * paths); a 403/422 surfaces honestly instead. The unit itself AND every
 * one of its descendants are excluded — a unit structurally can't move into
 * its own subtree — and remaining candidates are indented by depth with
 * their type icon so the hierarchy stays visible while picking.
 */
export function MoveOrgUnitDialog({
  unit,
  units,
  open,
  onOpenChange,
}: {
  unit: OrgUnitResponse;
  units: OrgUnitResponse[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [parentId, setParentId] = useState<string | null>(unit.parentId);
  const update = useUpdateOrgUnit();
  const unitsById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  );
  const candidates = useMemo(() => {
    const blocked = descendantIdsOf(unit.id, units);
    blocked.add(unit.id);
    return units.filter((candidate) => !blocked.has(candidate.id));
  }, [unit.id, units]);

  const submit = () => {
    if (parentId === unit.parentId) {
      onOpenChange(false);
      return;
    }
    update.mutate(
      { orgUnitId: unit.id, parentId },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move “{unit.name}”</DialogTitle>
          <DialogDescription>
            Choose a new parent, or make it a root organization. A unit can’t
            move into its own subtree.
          </DialogDescription>
        </DialogHeader>
        <div
          role="listbox"
          aria-label="New parent"
          className="flex max-h-60 flex-col gap-0.5 overflow-y-auto rounded-md border p-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={parentId === null}
            onClick={() => setParentId(null)}
            className={cn(
              "flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
              parentId === null && "bg-accent",
            )}
          >
            <Building2Icon className="size-[15px] shrink-0 text-muted-foreground" />
            — Make root organization —
          </button>
          {candidates.map((candidate) => {
            const depth = visibleAncestorChain(candidate, unitsById).length - 1;
            const Icon = ORG_UNIT_TYPE_META[candidate.type].icon;
            return (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={parentId === candidate.id}
                onClick={() => setParentId(candidate.id)}
                style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}
                className={cn(
                  "flex items-center gap-2 truncate rounded-sm py-1.5 pr-2 text-left text-sm hover:bg-accent",
                  parentId === candidate.id && "bg-accent",
                )}
              >
                <Icon className="size-[15px] shrink-0 text-muted-foreground" />
                <span className="truncate">{candidate.name}</span>
              </button>
            );
          })}
        </div>
        <ApiErrorMessage error={update.error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={update.isPending || parentId === unit.parentId}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Destructive, ownership-affecting: names the unit and the consequence up front (spec). */
export function DeleteOrgUnitDialog({
  unit,
  open,
  onOpenChange,
}: {
  unit: OrgUnitResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const del = useDeleteOrgUnit();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{unit.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes “{unit.name}” and removes every membership
            on it. This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ApiErrorMessage error={del.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Radix closes AlertDialog.Action on click unless prevented —
              // this dialog must stay open on failure so ApiErrorMessage
              // above can show it; only onSuccess below closes it.
              e.preventDefault();
              del.mutate(unit.id, { onSuccess: () => onOpenChange(false) });
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Pre-emptive leaf-first invariant (D4/task 4.1): a unit with children can't
 * be deleted server-side (children would dangle), so this is a pure
 * explainer — a single "Got it" acknowledgement, no Cancel, and crucially
 * NO mutation call. Directs the user to move or delete the children first.
 */
export function DeleteBlockedOrgUnitDialog({
  unit,
  childCount,
  open,
  onOpenChange,
}: {
  unit: OrgUnitResponse;
  childCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Can’t delete “{unit.name}”</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          “{unit.name}” has {childCount} child unit
          {childCount === 1 ? "" : "s"}. Units are deleted leaf-first — move or
          delete everything nested under it first, then delete it.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
