"use client";

import type { ProjectResponse } from "@/lib/services/project/types";

import { ProjectInstructionsSection } from "./project-instructions-section";
import { ProjectRepositoriesSection } from "./project-repositories-section";

/** The project page's side panel: the project's instructions and its
 *  repositories. From `lg` it takes the page grid's third column beside the
 *  composer and chats, out of flow so its height never stretches the
 *  composer's row. The instructions section is keyed by the project so an
 *  open editor never follows the page to another project. */
export function ProjectSidePanel({ project }: { project: ProjectResponse }) {
  return (
    <div className="min-w-0 lg:relative lg:col-start-3 lg:row-span-2 lg:row-start-1">
      <aside
        aria-label="Project settings"
        className="divide-y rounded-lg border lg:absolute lg:inset-x-0 lg:top-0"
      >
        <ProjectInstructionsSection key={project.id} project={project} />
        <ProjectRepositoriesSection projectId={project.id} />
      </aside>
    </div>
  );
}
