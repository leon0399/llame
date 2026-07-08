"use client";

import { useState } from "react";

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
import type { OrgUnitResponse } from "@/lib/services/org-units/types";

import { ApiErrorMessage } from "./api-error-message";

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
  const createRoot = useCreateRootOrg();
  const createChild = useCreateChildOrg();
  const mutation = parent ? createChild : createRoot;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const onSuccess = () => {
      setName("");
      onOpenChange(false);
    };
    if (parent) {
      createChild.mutate({ parentId: parent.id, name: trimmed }, { onSuccess });
    } else {
      createRoot.mutate({ name: trimmed }, { onSuccess });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("");
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
              ? "Create a child unit — a team, department, or project nested under this one."
              : "An organization is the top-level container for your teams, projects, chats, and members."}
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(unit.name);
          // Clear a previous attempt's error so reopening doesn't flash
          // stale copy before this attempt has even run.
          update.reset();
        }
        onOpenChange(next);
      }}
    >
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
 * Parent picker limited to loaded/visible units + a "make root" option (D6),
 * NOT a client-side "units I administer" filter — the server is the
 * authority on whether a given move is legal (admin-tier on both paths,
 * never into your own subtree); a 403/422 surfaces honestly instead.
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
  const candidates = units.filter((candidate) => candidate.id !== unit.id);

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setParentId(unit.parentId);
          // Clear a previous attempt's error so reopening doesn't flash
          // stale copy before this attempt has even run.
          update.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move “{unit.name}”</DialogTitle>
          <DialogDescription>
            Choose the new parent, or make it a root organization.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-1">
          <button
            type="button"
            onClick={() => setParentId(null)}
            className={cn(
              "rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
              parentId === null && "bg-accent",
            )}
          >
            — Make root organization —
          </button>
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setParentId(candidate.id)}
              className={cn(
                "truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                parentId === candidate.id && "bg-accent",
              )}
            >
              {candidate.name}
            </button>
          ))}
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
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Clear a previous attempt's error so reopening doesn't flash stale
        // copy before this attempt has even run.
        if (next) del.reset();
        onOpenChange(next);
      }}
    >
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
