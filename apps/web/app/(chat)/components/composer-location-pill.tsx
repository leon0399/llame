"use client";

import {
  AlertTriangleIcon,
  FolderGit2Icon,
  GitBranchIcon,
  MonitorIcon,
} from "lucide-react";

import { ButtonGroup } from "@workspace/ui/components/button-group";
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

import { ChipRemoveButton } from "./composer-project";
import { ComposerTooltip } from "./composer-tooltip";
import {
  folderName,
  WorkingDirectoryItems,
} from "./composer-working-directory";
import { PromptInputButton } from "./prompt-input";
import type { ComposerLocation } from "./use-composer-location";

/*
 * The working directory of a chat that does not exist yet, as one filled pill
 * beside the project chip (design D10): Machine, folder, and where in it the
 * chat works, each opening its own menu, then a joined × that alone removes
 * it. A chat without a working directory shows no pill; it is an ordinary
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

type PillMenuCellProps = {
  tooltip: string;
  ariaLabel: string;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
};

/** One filled cell: icon and capped name, opening a menu. */
function PillMenuCell(props: PillMenuCellProps) {
  return (
    <DropdownMenu>
      <ComposerTooltip
        label={props.tooltip}
        render={
          <DropdownMenuTrigger
            render={
              <PromptInputButton
                variant="secondary"
                size="default"
                aria-label={props.ariaLabel}
              />
            }
          />
        }
      >
        {props.icon}
        <span className="max-w-28 truncate font-normal">{props.label}</span>
      </ComposerTooltip>
      <DropdownMenuContent
        align="start"
        className="max-h-96 w-72 overflow-y-auto"
      >
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A Machine choice selects a `main` checkout of the repository on it at once —
 * the first by path when it holds several — so the pill never passes through
 * an unresolved state. The folder cell then changes the checkout.
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

/** The Machine cell: the Machines holding a `main` checkout of the repository,
 *  an unusable one disabled with its reason. */
function PillMachineCell({ location }: { location: ComposerLocation }) {
  const machine = location.location.executor?.label ?? "No checkout";
  return (
    <PillMenuCell
      tooltip="Machine"
      ariaLabel={`Machine, ${machine}`}
      icon={<MonitorIcon aria-hidden className="size-4" />}
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
    </PillMenuCell>
  );
}

/** The folder cell; the project chip owns the plain folder icon, so a
 *  checkout shows a git folder, and its tooltip prints the path. */
function PillFolderCell({
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
  return (
    <PillMenuCell
      tooltip={shown}
      ariaLabel={`Folder, ${folder}`}
      icon={<FolderGit2Icon aria-hidden className="size-4" />}
      label={folder}
    >
      <WorkingDirectoryItems
        location={location}
        onOtherFolder={onOtherFolder}
      />
    </PillMenuCell>
  );
}

/**
 * The mode cell: its label is the state — the checkout's branch while the chat
 * works in it, `Worktree` once it starts in a new worktree cut from that
 * branch (named by the server).
 */
function PillModeCell({ location }: { location: ComposerLocation }) {
  const branch = location.location.checkout?.branch ?? "detached HEAD";
  const worktree = location.isolation === "worktree";
  const label = worktree ? "Worktree" : branch;
  return (
    <PillMenuCell
      tooltip={
        worktree ? `New worktree from ${branch}` : `Checkout on ${branch}`
      }
      // The visible label leads the name, so it can be spoken to reach it.
      ariaLabel={`Work in, ${label}`}
      icon={<GitBranchIcon aria-hidden className="size-4" />}
      label={label}
    >
      <ChoiceGroup
        title="Work in"
        value={location.isolation}
        onValueChange={(value) => {
          if (value === "reuse" || value === "worktree") {
            location.selectIsolation(value);
          }
        }}
        choices={[
          { id: "reuse", label: "This checkout", detail: branch },
          { id: "worktree", label: "A new worktree", detail: `from ${branch}` },
        ]}
      />
    </PillMenuCell>
  );
}

/** A start that would fail, named under the pointer; nothing otherwise. A
 *  failed preview retries from here. */
function PillWarningCell({ location }: { location: ComposerLocation }) {
  const warning = location.location.warning;
  if (warning === null) return null;
  return (
    <ComposerTooltip
      label={warning.message}
      render={
        <PromptInputButton
          variant="secondary"
          size="icon"
          aria-label={`Location warning: ${warning.message}`}
          onClick={
            location.preview.failed ? location.preview.refetch : undefined
          }
        />
      }
    >
      <AlertTriangleIcon aria-hidden className="text-destructive size-4" />
    </ComposerTooltip>
  );
}

/** The pill; renders nothing while no working directory resolves. */
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
    <ButtonGroup>
      <PillMachineCell location={location} />
      <PillFolderCell
        location={location}
        path={checkout.path}
        onOtherFolder={onOtherFolder}
      />
      <PillModeCell location={location} />
      <PillWarningCell location={location} />
      <ChipRemoveButton
        label="Remove working directory"
        onRemove={location.clearWorkingDirectory}
      />
    </ButtonGroup>
  );
}
