"use client";

import { useState } from "react";
import { FolderIcon, FolderOpenIcon } from "lucide-react";

import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@workspace/ui/components/dropdown-menu";

import {
  ComposerLocationPill,
  StartRowMenu,
  StartRowRemoveButton,
} from "./composer-location-pill";
import { type ComposerProject, ProjectPickerItems } from "./composer-project";
import {
  OtherFolderDialog,
  WorkingDirectoryItems,
} from "./composer-working-directory";
import type { ComposerLocation } from "./use-composer-location";

/*
 * Where a new chat starts, on the left of the row under the input: one
 * "Project or folder" picker until something is chosen, then the project and
 * the working directory as their own quiet controls. A chat that exists has
 * neither, so the row shows only its model and permission settings.
 */

/** Nothing chosen yet: one picker over projects and folders. */
function ProjectOrFolderPicker({
  project,
  location,
  onOtherFolder,
}: {
  project: ComposerProject | undefined;
  location: ComposerLocation | undefined;
  onOtherFolder: () => void;
}) {
  const label = project === undefined ? "Folder" : "Project or folder";

  return (
    <StartRowMenu
      tooltip="Start in a project or a folder"
      ariaLabel={label}
      icon={<FolderOpenIcon aria-hidden />}
      label={label}
      wide
    >
      {project === undefined ? null : (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          <ProjectPickerItems project={project} />
        </DropdownMenuGroup>
      )}
      {project !== undefined && location !== undefined && (
        <DropdownMenuSeparator />
      )}
      {/* The folder list labels its own groups ("This project",
          "Checkouts"). */}
      {location === undefined ? null : (
        <WorkingDirectoryItems
          location={location}
          onOtherFolder={onOtherFolder}
        />
      )}
    </StartRowMenu>
  );
}

/** The chosen project: its name changes it, its × leaves the chat unfiled.
 *  Where the page fixes the project (the project page), the page already
 *  names it, so the row shows nothing for it. */
function ProjectControl({
  project,
  selected,
}: {
  project: ComposerProject;
  selected: NonNullable<ComposerProject["selected"]>;
}) {
  if (project.locked === true) return null;

  return (
    <>
      <StartRowMenu
        tooltip="Project"
        ariaLabel={`Project, ${selected.name}`}
        icon={<FolderIcon aria-hidden />}
        label={selected.name}
        wide
      >
        <ProjectPickerItems project={project} />
      </StartRowMenu>
      <StartRowRemoveButton
        label={`Remove from project ${selected.name}`}
        onRemove={() => project.onSelect(null)}
      />
    </>
  );
}

/** A project with no working directory yet can still be given one. */
function FolderPicker({
  location,
  onOtherFolder,
}: {
  location: ComposerLocation;
  onOtherFolder: () => void;
}) {
  return (
    <StartRowMenu
      tooltip="Work in a folder"
      ariaLabel="Folder"
      icon={<FolderOpenIcon aria-hidden />}
      label="Folder"
      wide
    >
      <WorkingDirectoryItems
        location={location}
        onOtherFolder={onOtherFolder}
      />
    </StartRowMenu>
  );
}

function StartControls({
  project,
  location,
  onOtherFolder,
}: {
  project: ComposerProject | undefined;
  location: ComposerLocation | undefined;
  onOtherFolder: () => void;
}) {
  const selected = project?.selected ?? null;
  const checkout = location?.location.checkout ?? null;

  if (selected === null && checkout === null) {
    return (
      <ProjectOrFolderPicker
        project={project}
        location={location}
        onOtherFolder={onOtherFolder}
      />
    );
  }

  return (
    <>
      {project !== undefined && selected !== null && (
        <ProjectControl project={project} selected={selected} />
      )}
      {location !== undefined &&
        (checkout === null ? (
          <FolderPicker location={location} onOtherFolder={onOtherFolder} />
        ) : (
          <ComposerLocationPill
            location={location}
            onOtherFolder={onOtherFolder}
          />
        ))}
    </>
  );
}

/** The start controls with the typed-folder dialog their menus open; nothing
 *  for a chat that already exists. */
export function ComposerStartRow({
  project,
  location,
}: {
  project: ComposerProject | undefined;
  location: ComposerLocation | undefined;
}) {
  const [otherFolder, setOtherFolder] = useState(false);

  if (project === undefined && location === undefined) return null;

  return (
    // One line that scrolls sideways rather than wrapping, so a long folder
    // name never changes the composer's height.
    <div className="flex min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto @2xl:flex-1">
      <StartControls
        project={project}
        location={location}
        onOtherFolder={() => setOtherFolder(true)}
      />
      {location === undefined ? null : (
        <OtherFolderDialog
          open={otherFolder}
          onOpenChange={setOtherFolder}
          location={location}
        />
      )}
    </div>
  );
}
