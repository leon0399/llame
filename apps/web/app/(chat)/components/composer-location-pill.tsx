"use client";

import {
  AlertTriangleIcon,
  ChevronDownIcon,
  FolderGit2Icon,
  MonitorIcon,
  SquareCheckIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

import { machinePathFromRoot } from "@/lib/services/machines/locator";

import { ComposerTooltip } from "./composer-tooltip";
import {
  folderName,
  WorkingDirectoryItems,
} from "./composer-working-directory";
import type { ComposerLocation } from "./use-composer-location";

/*
 * The working directory of a chat that does not exist yet, in the row under
 * the input (design D10): the Machine when there is a choice of one, the
 * folder, a Worktree toggle, then a × that alone removes it. Each is a quiet
 * ghost control like the model and effort beside them, not a filled chip. A
 * chat without a working directory shows none of them; it is an ordinary
 * unbound start, never a warning.
 */

type Choice = {
  id: string;
  label: string;
  /** A path or the reason the choice is unavailable, on a second line. */
  detail?: string;
  disabled?: boolean;
};

/** One choice: its label over a detail line (a path, or why it is disabled). */
function ChoiceItem({ choice }: { choice: Choice }) {
  return (
    <DropdownMenuRadioItem
      closeOnClick
      value={choice.id}
      disabled={choice.disabled}
      aria-label={
        choice.detail === undefined
          ? choice.label
          : `${choice.label}: ${choice.detail}`
      }
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{choice.label}</span>
        {choice.detail === undefined ? null : (
          <span className="text-muted-foreground truncate text-xs">
            {choice.detail}
          </span>
        )}
      </span>
    </DropdownMenuRadioItem>
  );
}

/** One labelled radio group of a cell's menu. */
function ChoiceGroup({
  title,
  choices,
  value,
  onValueChange,
}: {
  title: string;
  choices: Array<Choice>;
  value: string | null;
  onValueChange: (id: string) => void;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{title}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onValueChange}>
        {choices.map((choice) => (
          <ChoiceItem key={choice.id} choice={choice} />
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

type StartRowMenuProps = {
  tooltip: string;
  ariaLabel: string;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  /** Widens the menu for path and project lists. */
  wide?: boolean;
};

/** One control of the row under the input: icon, capped name and a chevron,
 *  opening a menu. Shared by the location cells and the project picker. */
export function StartRowMenu(props: StartRowMenuProps) {
  return (
    <DropdownMenu>
      <ComposerTooltip
        label={props.tooltip}
        render={
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={props.ariaLabel}
                className="min-w-0"
              />
            }
          />
        }
      >
        {props.icon}
        <span className="max-w-24 truncate font-normal @2xl:max-w-32">
          {props.label}
        </span>
        <ChevronDownIcon aria-hidden className="opacity-60" />
      </ComposerTooltip>
      <DropdownMenuContent
        align="start"
        className={props.wide === true ? "max-h-96 w-72" : "max-h-96 w-64"}
      >
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The quiet × that clears one choice of the row. */
export function StartRowRemoveButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <ComposerTooltip
      label={label}
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={onRemove}
        />
      }
    >
      <XIcon aria-hidden />
    </ComposerTooltip>
  );
}

/**
 * A Machine choice selects a `main` checkout of the repository on it at once —
 * the first by path when it holds several — so the row never passes through
 * an unresolved state. The folder control then changes the checkout.
 */
function selectMachine(location: ComposerLocation, executorId: string) {
  const [first] = location.checkouts
    .filter(
      (row) =>
        row.kind === "main" &&
        row.executorId === executorId &&
        row.repositoryId === location.location.repositoryId,
    )
    .sort((left, right) => left.path.localeCompare(right.path));

  if (first !== undefined) location.selectWorkingDirectory(first);
}

/** The Machine control: only when the repository is on more than one
 *  Machine, since a single choice is no choice. An unusable one is listed
 *  disabled with its reason. */
function MachineControl({ location }: { location: ComposerLocation }) {
  if (location.machineOptions.length < 2) return null;

  const machine = location.location.executor?.label ?? "No checkout";

  return (
    <StartRowMenu
      tooltip="Machine"
      ariaLabel={`Machine, ${machine}`}
      icon={<MonitorIcon aria-hidden />}
      label={machine}
    >
      <ChoiceGroup
        title="Machine"
        value={location.location.executor?.executorId ?? null}
        onValueChange={(executorId) => selectMachine(location, executorId)}
        choices={location.machineOptions.map((option) => ({
          id: option.executorId,
          label: option.label,
          detail: option.reason ?? undefined,
          disabled: option.reason !== null,
        }))}
      />
    </StartRowMenu>
  );
}

/** The folder control; its tooltip prints the path and the branch. */
function FolderControl({
  location,
  path,
  onOtherFolder,
}: {
  location: ComposerLocation;
  path: string;
  onOtherFolder: () => void;
}) {
  const folder = folderName(path);
  const shown = machinePathFromRoot(path) ?? path;
  const branch = location.location.checkout?.branch ?? "detached HEAD";

  return (
    <StartRowMenu
      tooltip={`${shown} · ${branch}`}
      ariaLabel={`Folder, ${folder}`}
      icon={<FolderGit2Icon aria-hidden />}
      label={folder}
      wide
    >
      <WorkingDirectoryItems
        location={location}
        onOtherFolder={onOtherFolder}
      />
    </StartRowMenu>
  );
}

/**
 * Where in the checkout the chat works, as one toggle: off works in the
 * checkout on its branch, on starts a new worktree cut from that branch
 * (named by the server).
 */
function WorktreeToggle({ location }: { location: ComposerLocation }) {
  const branch = location.location.checkout?.branch ?? "detached HEAD";
  const worktree = location.isolation === "worktree";

  return (
    <ComposerTooltip
      label={
        worktree
          ? `New worktree from ${branch}`
          : `Work in the checkout on ${branch}`
      }
      render={
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-pressed={worktree}
          onClick={() =>
            location.selectIsolation(worktree ? "reuse" : "worktree")
          }
        />
      }
    >
      {worktree ? <SquareCheckIcon aria-hidden /> : <SquareIcon aria-hidden />}
      <span className="font-normal">Worktree</span>
    </ComposerTooltip>
  );
}

/** A start that would fail, named under the pointer; nothing otherwise. A
 *  failed preview retries from here. */
function WarningControl({ location }: { location: ComposerLocation }) {
  const warning = location.location.warning;

  if (warning === null) return null;

  return (
    <ComposerTooltip
      label={warning.message}
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Location warning: ${warning.message}`}
          onClick={
            location.preview.failed ? location.preview.refetch : undefined
          }
        />
      }
    >
      <AlertTriangleIcon aria-hidden className="text-destructive" />
    </ComposerTooltip>
  );
}

/** The working directory's controls; nothing while none resolves. */
export function ComposerLocationPill({
  location,
  onOtherFolder,
}: {
  location: ComposerLocation;
  onOtherFolder: () => void;
}) {
  const checkout = location.location.checkout;

  if (checkout === null) return null;

  return (
    <>
      <MachineControl location={location} />
      <FolderControl
        location={location}
        path={checkout.path}
        onOtherFolder={onOtherFolder}
      />
      <WorktreeToggle location={location} />
      <WarningControl location={location} />
      <StartRowRemoveButton
        label="Remove working directory"
        onRemove={location.clearWorkingDirectory}
      />
    </>
  );
}
