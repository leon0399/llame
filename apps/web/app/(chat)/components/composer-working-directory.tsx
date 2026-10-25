"use client";

import { useId, useState } from "react";
import { FolderOpenIcon } from "lucide-react";

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";

import { DialogFrame } from "@/components/dialog-frame";
import { DialogSubmitFooter } from "@/components/dialog-submit-footer";
import type { CheckoutResponse } from "@/lib/api/generated/models";
import { useRegisterCheckout } from "@/lib/services/checkouts/mutations";
import { machinePathFromRoot } from "@/lib/services/machines/locator";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import { repositoryFailureMessage } from "@/lib/services/repositories/failure";

import type {
  ComposerLocation,
  WorkingDirectoryOption,
} from "./use-composer-location";

/*
 * The working directory of a chat that does not exist yet: a registered
 * checkout, chosen from the `+` menu or the location row, or a folder typed by
 * hand. A typed folder that is already registered is that checkout; any other
 * is registered first, so it gets the same repository, mode and branch
 * options (openspec `repositories`: registration derives the executor from
 * the path, `machine://<name>/…` naming a Machine).
 */

const LOCAL = "local";

/** The last path segment, which is how a folder reads in a small control. */
export function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

function DirectoryItem({ option }: { option: WorkingDirectoryOption }) {
  return (
    <DropdownMenuRadioItem
      value={option.checkoutId}
      aria-label={`${option.machine}: ${option.path}`}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{folderName(option.path)}</span>
        <span className="text-muted-foreground truncate text-xs">
          {option.machine} · {machinePathFromRoot(option.path) ?? option.path}
        </span>
      </span>
    </DropdownMenuRadioItem>
  );
}

function DirectoryGroup({
  title,
  options,
}: {
  title: string;
  options: Array<WorkingDirectoryOption>;
}) {
  if (options.length === 0) return null;
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{title}</DropdownMenuLabel>
      {options.map((option) => (
        <DirectoryItem key={option.checkoutId} option={option} />
      ))}
    </DropdownMenuGroup>
  );
}

/**
 * The registered checkouts as one radio list: the project's own repositories
 * first, then every other one, with "Other folder…" last.
 */
export function WorkingDirectoryItems({
  location,
  onOtherFolder,
}: {
  location: ComposerLocation;
  onOtherFolder: () => void;
}) {
  const options = location.workingDirectories;
  const select = (checkoutId: string) => {
    const row = location.checkouts.find((item) => item.id === checkoutId);
    if (row !== undefined) location.selectWorkingDirectory(row);
  };
  return (
    <>
      <DropdownMenuRadioGroup
        value={location.location.checkout?.id ?? ""}
        onValueChange={select}
      >
        <DirectoryGroup
          title="This project"
          options={options.filter((row) => row.linked)}
        />
        <DirectoryGroup
          title="Checkouts"
          options={options.filter((row) => !row.linked)}
        />
      </DropdownMenuRadioGroup>
      {options.length === 0 ? null : <DropdownMenuSeparator />}
      {/* Deferred so the menu closes before the dialog takes focus. */}
      <DropdownMenuItem onSelect={() => setTimeout(onOtherFolder, 0)}>
        Other folder…
      </DropdownMenuItem>
    </>
  );
}

/** The `+` menu's "Add working directory" submenu. */
export function ComposerWorkingDirectorySubmenu({
  location,
  onOtherFolder,
}: {
  location: ComposerLocation;
  onOtherFolder: () => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderOpenIcon />
        <span>
          {location.location.checkout === null
            ? "Add working directory"
            : "Change working directory"}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="max-h-96 w-72 overflow-y-auto">
          <WorkingDirectoryItems
            location={location}
            onOtherFolder={onOtherFolder}
          />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/** A typed path as checkouts store it: a Machine's folder is its
 *  `machine://<name>/…` locator, a local one the plain path. */
function folderLocator(machine: string, path: string): string {
  const trimmed = path.replace(/(.)\/+$/u, "$1");
  return machine === LOCAL ? trimmed : `machine://${machine}${trimmed}`;
}

/** The registered `main` checkout at this locator, if any. A worktree's path
 *  resolves to the main clone it was cut from. */
function registeredAt(
  checkouts: ReadonlyArray<CheckoutResponse>,
  locator: string,
): CheckoutResponse | undefined {
  const row = checkouts.find((item) => item.path === locator);
  if (row === undefined || row.kind === "main") return row;
  return checkouts.find((item) => item.id === row.parentCheckoutId);
}

function MachineField({
  value,
  onChange,
}: {
  value: string;
  onChange: (machine: string) => void;
}) {
  const id = useId();
  const machines = useMachinesQuery().data ?? [];
  const items = [
    { value: LOCAL, label: "This server" },
    ...machines.map((machine) => ({
      value: machine.name,
      label: machine.name,
    })),
  ];
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Machine</Label>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FolderPathField({
  id,
  path,
  onPath,
  onSubmit,
}: {
  id: string;
  path: string;
  onPath: (path: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Folder</Label>
      <Input
        id={id}
        value={path}
        placeholder="/home/leo/src/llame"
        onChange={(event) => onPath(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onSubmit();
        }}
        // Deliberate: the dialog's primary field (WAI-ARIA dialog pattern).
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
    </div>
  );
}

/**
 * The typed folder's use: the registered checkout at that path, else a new
 * registration, which the server refuses for a folder that is not a clone.
 */
function useTypedFolder(location: ComposerLocation, onClose: () => void) {
  const [failure, setFailure] = useState<string | null>(null);
  const register = useRegisterCheckout();
  const submit = async (machine: string, path: string) => {
    if (!path.startsWith("/") || register.isPending) return;
    try {
      const locator = folderLocator(machine, path);
      const row =
        registeredAt(location.checkouts, locator) ??
        (await register.mutateAsync({ path: locator }));
      location.selectWorkingDirectory(row);
      onClose();
    } catch (error) {
      setFailure(
        repositoryFailureMessage(error, "The folder could not be used."),
      );
    }
  };
  return { submit, failure, pending: register.isPending };
}

/** The dialog body: mounted per open, so every open starts blank. */
function OtherFolderForm({
  location,
  onClose,
}: {
  location: ComposerLocation;
  onClose: () => void;
}) {
  const id = useId();
  const [machine, setMachine] = useState(LOCAL);
  const [path, setPath] = useState("");
  const folder = useTypedFolder(location, onClose);
  const submit = () => void folder.submit(machine, path.trim());
  return (
    <>
      <MachineField value={machine} onChange={setMachine} />
      <FolderPathField id={id} path={path} onPath={setPath} onSubmit={submit} />
      {folder.failure === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {folder.failure}
        </p>
      )}
      <DialogSubmitFooter
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Use folder"
        submitDisabled={!path.trim().startsWith("/") || folder.pending}
      />
    </>
  );
}

/** "Other folder…": a Machine and an absolute path, typed by hand. */
export function OtherFolderDialog({
  open,
  onOpenChange,
  location,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: ComposerLocation;
}) {
  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Working directory"
    >
      <OtherFolderForm
        location={location}
        onClose={() => onOpenChange(false)}
      />
    </DialogFrame>
  );
}
