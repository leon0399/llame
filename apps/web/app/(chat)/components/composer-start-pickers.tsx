"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { CommandGroup, CommandItem } from "@workspace/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";

import { ProjectSelect } from "@/components/project-select";
import {
  SearchList,
  SearchListAction,
  SearchListCheck,
} from "@/components/search-list";
import { machinePathFromRoot } from "@/lib/services/machines/locator";

import { NewProjectDialog } from "./chat-list-sidebar/project-dialogs";
import { ComposerTooltip } from "./composer-tooltip";
import type { ComposerProject } from "./composer-project";
import { folderName } from "./composer-working-directory";
import type {
  ComposerLocation,
  WorkingDirectoryOption,
} from "./use-composer-location";

/*
 * The two choices of where a new chat starts, each a search list whose
 * search filters only its own items: the project, and the folder. Each list
 * starts with the way to clear its choice, so the row has no separate ×.
 */

/** The trigger of a start picker: icon, name trimmed to its cap height so
 *  the icon lines up with the letters, clipped only sideways so descenders
 *  survive, and a chevron. */
function StartPickerTrigger({
  tooltip,
  ariaLabel,
  icon,
  label,
}: {
  tooltip: string;
  ariaLabel: string;
  icon: ReactNode;
  label: ReactNode;
}) {
  return (
    <ComposerTooltip
      label={tooltip}
      render={
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={ariaLabel}
              className="min-w-9 shrink @xs:min-w-16 @md:min-w-24"
            />
          }
        />
      }
    >
      {icon}
      <span className="min-w-0 overflow-x-clip font-normal text-ellipsis whitespace-nowrap text-trim-cap">
        {label}
      </span>
      <ChevronDownIcon aria-hidden className="opacity-60 @max-xs:hidden" />
    </ComposerTooltip>
  );
}

/** A quiet control in the row under the input that opens a search list. */
function StartPicker({
  children,
  ...trigger
}: Parameters<typeof StartPickerTrigger>[0] & {
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <StartPickerTrigger {...trigger} />
      <PopoverContent
        aria-label={trigger.tooltip}
        align="start"
        flush
        className="w-80"
      >
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/** The project the chat is filed into; hidden where the page fixes it. A
 *  project created from here becomes the choice. */
export function ProjectPicker({ project }: { project: ComposerProject }) {
  const [creating, setCreating] = useState(false);

  if (project.locked === true) return null;

  const selected = project.selected;

  return (
    <>
      <StartPicker
        tooltip="Project"
        ariaLabel={selected === null ? "Project" : `Project, ${selected.name}`}
        icon={<FolderIcon aria-hidden />}
        label={selected?.name ?? "Project"}
      >
        {(close) => (
          <ProjectSelect
            projects={project.projects}
            selectedId={selected?.id ?? null}
            onSelect={(projectId) => {
              project.onSelect(projectId);
              close();
            }}
            onNewProject={() => {
              close();
              // Deferred so the popover closes before the dialog takes focus.
              setTimeout(() => setCreating(true), 0);
            }}
          />
        )}
      </StartPicker>
      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(created) => project.onSelect(created.id)}
      />
    </>
  );
}

function FolderItem({
  option,
  selected,
  onSelect,
}: {
  option: WorkingDirectoryOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const path = machinePathFromRoot(option.path) ?? option.path;

  return (
    <CommandItem
      value={`${folderName(option.path)} ${option.machine} ${path}`}
      aria-label={`${option.machine}: ${option.path}`}
      aria-checked={selected}
      onSelect={onSelect}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{folderName(option.path)}</span>
        <span className="truncate text-xs text-muted-foreground">
          {option.machine} · {path}
        </span>
      </span>
      <SearchListCheck on={selected} />
    </CommandItem>
  );
}

function FolderGroup({
  heading,
  options,
  location,
  close,
}: {
  heading: string;
  options: Array<WorkingDirectoryOption>;
  location: ComposerLocation;
  close: () => void;
}) {
  if (options.length === 0) return null;

  const current = location.location.checkout?.id;

  return (
    <CommandGroup heading={heading}>
      {options.map((option) => (
        <FolderItem
          key={option.checkoutId}
          option={option}
          selected={option.checkoutId === current}
          onSelect={() => {
            const row = location.checkouts.find(
              (item) => item.id === option.checkoutId,
            );

            if (row !== undefined) location.selectWorkingDirectory(row);
            close();
          }}
        />
      ))}
    </CommandGroup>
  );
}

/** "No folder": an unbound start, checked while no folder is chosen. */
function NoFolderAction({
  location,
  close,
}: {
  location: ComposerLocation;
  close: () => void;
}) {
  return (
    <SearchListAction
      position="first"
      label="No folder"
      checked={location.location.checkout === null}
      onSelect={() => {
        location.clearWorkingDirectory();
        close();
      }}
    />
  );
}

/** "Other folder…": a path typed by hand, in its own dialog. */
function OtherFolderAction({
  onOtherFolder,
  close,
}: {
  onOtherFolder: () => void;
  close: () => void;
}) {
  return (
    <SearchListAction
      position="last"
      label="Other folder…"
      onSelect={() => {
        close();
        // Deferred so the popover closes before the dialog takes focus.
        setTimeout(onOtherFolder, 0);
      }}
    />
  );
}

/** The folder list: no folder first, the project's repositories, every other
 *  checkout, then a typed folder. */
function FolderSearchItems({
  location,
  onOtherFolder,
  close,
}: {
  location: ComposerLocation;
  onOtherFolder: () => void;
  close: () => void;
}) {
  const options = location.workingDirectories;

  return (
    <SearchList
      placeholder="Search folders…"
      first={<NoFolderAction location={location} close={close} />}
      last={<OtherFolderAction onOtherFolder={onOtherFolder} close={close} />}
    >
      <FolderGroup
        heading="This project"
        options={options.filter((row) => row.linked)}
        location={location}
        close={close}
      />
      <FolderGroup
        heading="Checkouts"
        options={options.filter((row) => !row.linked)}
        location={location}
        close={close}
      />
    </SearchList>
  );
}

/** Why the last create could not prepare the folder, above its list. */
function FolderWarning({ message }: { message: string }) {
  return (
    <p className="flex gap-1.5 border-b px-3 py-2 text-xs text-destructive [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0">
      <AlertTriangleIcon aria-hidden />
      {message}
    </p>
  );
}

/** The folder the chat works in. A create that could not prepare it (bind,
 *  worktree, or a lost link) is named here, on the control it concerns. */
export function FolderPicker({
  location,
  onOtherFolder,
}: {
  location: ComposerLocation;
  onOtherFolder: () => void;
}) {
  const checkout = location.location.checkout;
  const name = checkout === null ? null : folderName(checkout.path);
  const warning = location.location.warning;
  const failed = warning?.step === "workspace" ? warning.message : null;

  return (
    <StartPicker
      tooltip={failed ?? "Folder"}
      ariaLabel={[name === null ? "Folder" : `Folder, ${name}`, failed]
        .filter((part) => part !== null)
        .join(", ")}
      icon={
        <FolderOpenIcon
          aria-hidden
          className={failed === null ? undefined : "text-destructive"}
        />
      }
      label={name ?? "Folder"}
    >
      {(close) => (
        <>
          {failed === null ? null : <FolderWarning message={failed} />}
          <FolderSearchItems
            location={location}
            onOtherFolder={onOtherFolder}
            close={close}
          />
        </>
      )}
    </StartPicker>
  );
}
