"use client";

import { useMemo, useState } from "react";

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
import { descendantIdsOf } from "./org-tree-utils";
import {
  MoveTargetList,
  OrgDialogFooter,
  OrgUnitTypePicker,
} from "./org-unit-dialog-parts";

const DEFAULT_CHILD_TYPE: OrgUnitType = "group";

function CreateOrgUnitNameField({
  name,
  onNameChange,
  onSubmit,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="org-unit-name" className="text-[0.8rem]">
        Name
      </Label>
      <Input
        id="org-unit-name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        className="px-[0.65rem] text-[0.9rem] md:text-[0.9rem]"
        // Deliberate: WAI-ARIA dialog pattern moves focus into the modal on
        // open; this is the dialog's primary field.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
    </div>
  );
}

function CreateOrgUnitHeader({ parent }: { parent?: OrgUnitResponse }) {
  return (
    <DialogHeader className="gap-[0.35rem]">
      <DialogTitle className="text-base">
        {parent ? `New unit under “${parent.name}”` : "New organization"}
      </DialogTitle>
      <DialogDescription className="text-[0.83rem] leading-[1.45]">
        {parent
          ? "Create a child unit nested under this one. Members and roles inherit down from the parent."
          : "An organization is the top-level container for your teams, chats, and members."}
      </DialogDescription>
    </DialogHeader>
  );
}

/** The form's state, reset-on-close, and dual create-root/create-child
 *  submit — split out so `CreateOrgUnitDialog` composes only markup. */
function useCreateOrgUnitForm(
  parent: OrgUnitResponse | undefined,
  onOpenChange: (open: boolean) => void,
) {
  const [name, setName] = useState("");
  const [type, setType] = useState<OrgUnitType>(DEFAULT_CHILD_TYPE);
  const createRoot = useCreateRootOrg();
  const createChild = useCreateChildOrg();
  const mutation = parent ? createChild : createRoot;

  const reset = () => {
    setName("");
    setType(DEFAULT_CHILD_TYPE);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const onSuccess = () => {
      reset();
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

  const onDialogOpenChange = (next: boolean) => {
    if (!next) reset();
    // Clear a previous attempt's error so reopening doesn't flash stale copy
    // before this attempt has even run.
    if (next) mutation.reset();
    onOpenChange(next);
  };

  return { name, setName, type, setType, mutation, submit, onDialogOpenChange };
}

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
  const { name, setName, type, setType, mutation, submit, onDialogOpenChange } =
    useCreateOrgUnitForm(parent, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent className="top-[15vh] translate-y-0 px-[1.2rem] sm:max-w-[26rem]">
        <CreateOrgUnitHeader parent={parent} />
        <CreateOrgUnitNameField
          name={name}
          onNameChange={setName}
          onSubmit={submit}
        />
        {parent && <OrgUnitTypePicker type={type} onTypeChange={setType} />}
        <ApiErrorMessage error={mutation.error} />
        <OrgDialogFooter
          onCancel={() => onOpenChange(false)}
          onSubmit={submit}
          submitLabel="Create"
          submitDisabled={!name.trim() || mutation.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameOrgUnitField({
  name,
  onNameChange,
  onSubmit,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Input
      value={name}
      onChange={(e) => onNameChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit();
        }
      }}
      className="px-[0.65rem] text-[0.9rem] md:text-[0.9rem]"
      aria-label="Name"
      // Deliberate: WAI-ARIA dialog pattern moves focus into the modal on
      // open; this is the dialog's primary field.
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
    />
  );
}

/** The rename dialog's body — split out of `RenameOrgUnitDialog` as its own
 *  self-contained region. */
function RenameOrgUnitDialogBody({
  unit,
  name,
  onNameChange,
  submit,
  update,
  onOpenChange,
}: {
  unit: OrgUnitResponse;
  name: string;
  onNameChange: (name: string) => void;
  submit: () => void;
  update: ReturnType<typeof useUpdateOrgUnit>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogContent className="top-[15vh] translate-y-0 px-[1.2rem] sm:max-w-[26rem]">
      <DialogHeader>
        <DialogTitle className="text-base">Rename “{unit.name}”</DialogTitle>
      </DialogHeader>
      <RenameOrgUnitField
        name={name}
        onNameChange={onNameChange}
        onSubmit={submit}
      />
      <ApiErrorMessage error={update.error} />
      <OrgDialogFooter
        onCancel={() => onOpenChange(false)}
        onSubmit={submit}
        submitLabel="Save"
        submitDisabled={!name.trim() || update.isPending}
      />
    </DialogContent>
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
      <RenameOrgUnitDialogBody
        unit={unit}
        name={name}
        onNameChange={setName}
        submit={submit}
        update={update}
        onOpenChange={onOpenChange}
      />
    </Dialog>
  );
}

/** The candidate parent list (units minus the unit's own subtree) and its id
 *  lookup — split out from `MoveOrgUnitDialog` as a pure derivation. */
function useMoveTargets(unit: OrgUnitResponse, units: Array<OrgUnitResponse>) {
  const unitsById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  );
  const candidates = useMemo(() => {
    const blocked = descendantIdsOf(unit.id, units);
    blocked.add(unit.id);
    return units.filter((candidate) => !blocked.has(candidate.id));
  }, [unit.id, units]);

  return { unitsById, candidates };
}

type MoveOrgUnitDialogProps = {
  unit: OrgUnitResponse;
  units: Array<OrgUnitResponse>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function MoveOrgUnitHeader({ unit }: { unit: OrgUnitResponse }) {
  return (
    <DialogHeader className="gap-[0.35rem]">
      <DialogTitle className="text-base">Move “{unit.name}”</DialogTitle>
      <DialogDescription className="text-[0.83rem] leading-[1.45]">
        Choose a new parent, or make it a root organization. A unit can’t move
        into its own subtree.
      </DialogDescription>
    </DialogHeader>
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
}: MoveOrgUnitDialogProps) {
  const [parentId, setParentId] = useState<string | null>(unit.parentId);
  const update = useUpdateOrgUnit();
  const { unitsById, candidates } = useMoveTargets(unit, units);

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
      <DialogContent className="top-[15vh] translate-y-0 px-[1.2rem] sm:max-w-[26rem]">
        <MoveOrgUnitHeader unit={unit} />
        <MoveTargetList
          candidates={candidates}
          unitsById={unitsById}
          parentId={parentId}
          onParentIdChange={setParentId}
        />
        <ApiErrorMessage error={update.error} />
        <OrgDialogFooter
          onCancel={() => onOpenChange(false)}
          onSubmit={submit}
          submitLabel="Move"
          submitDisabled={update.isPending || parentId === unit.parentId}
        />
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
      <AlertDialogContent className="top-[15vh] translate-y-0 px-[1.2rem] sm:max-w-[26rem]">
        <AlertDialogHeader className="gap-[0.35rem]">
          <AlertDialogTitle className="text-base">
            Delete “{unit.name}”?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[0.86rem] leading-normal">
            This permanently deletes “{unit.name}” and removes every membership
            on it. This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ApiErrorMessage error={del.error} />
        <AlertDialogFooter>
          <AlertDialogCancel className="text-[0.86rem]">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              // AlertDialogAction (Base UI) does not auto-close; this
              // controlled dialog stays open on failure so ApiErrorMessage
              // above can show it, and closes only on success.
              del.mutate(unit.id, { onSuccess: () => onOpenChange(false) });
            }}
            className="bg-destructive text-[0.86rem] text-white hover:bg-destructive/90"
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
      <DialogContent className="top-[15vh] translate-y-0 px-[1.2rem] sm:max-w-[26rem]">
        <DialogHeader>
          <DialogTitle className="text-base">
            Can’t delete “{unit.name}”
          </DialogTitle>
        </DialogHeader>
        <p className="text-[0.86rem] leading-normal text-muted-foreground">
          “{unit.name}” has {childCount} child unit
          {childCount === 1 ? "" : "s"}. Units are deleted leaf-first — move or
          delete everything nested under it first, then delete it.
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            className="text-[0.86rem]"
            onClick={() => onOpenChange(false)}
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
