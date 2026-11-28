"use client";

import { useState } from "react";

import { ComposerLocationPill } from "./composer-location-pill";
import type { ComposerProject } from "./composer-project";
import { FolderPicker, ProjectPicker } from "./composer-start-pickers";
import { OtherFolderDialog } from "./composer-working-directory";
import type { ComposerLocation } from "./use-composer-location";

/*
 * Where a new chat starts, on the left of the row under the input: the
 * project and the folder, each a search list, then the working directory's
 * own controls once a folder is chosen. A chat that exists has none of them,
 * so its row shows only the permission mode.
 */

function StartControls({
  project,
  location,
  onOtherFolder,
}: {
  project: ComposerProject | undefined;
  location: ComposerLocation | undefined;
  onOtherFolder: () => void;
}) {
  return (
    <>
      {project === undefined ? null : <ProjectPicker project={project} />}
      {location === undefined ? null : (
        <>
          <FolderPicker location={location} onOtherFolder={onOtherFolder} />
          <ComposerLocationPill location={location} />
        </>
      )}
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
    // One line that never scrolls or wraps: each control shrinks and cuts its
    // name, so a long folder name never changes the composer's height.
    <div className="flex min-w-0 flex-nowrap items-center gap-0.5">
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
