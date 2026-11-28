"use client";

import { useState } from "react";
import Link from "next/link";
import { FolderIcon, FolderPlusIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";

import { useProjectsQuery } from "@/lib/services/project/queries";

import { NewProjectDialog } from "../components/chat-list-sidebar/project-dialogs";
import { PageHeader } from "../components/page-header";

/** The phone's project list. The projects rail is desktop-only, so without
 *  this a phone could reach a project only through a pin or a deep link. */
function PhoneProjectList() {
  const { data, isPending } = useProjectsQuery();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <Button variant="outline" onClick={() => setCreating(true)}>
        <FolderPlusIcon aria-hidden />
        New project
      </Button>
      {isPending ? (
        <Skeleton className="h-24" />
      ) : (data ?? []).length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No projects yet.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {(data ?? []).map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="flex min-h-11 items-center gap-3 px-4 text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
              >
                <FolderIcon aria-hidden />
                <span className="truncate">{project.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

// /projects index: on desktop the rail (ProjectListSidebar) carries the list
// and this pane asks the user to pick or create one; on a phone it is the
// list.
export default function ProjectsPage() {
  // Rendered, not CSS-hidden, per width: a hidden copy would duplicate the
  // rail's rows for assistive tech and fetch for nothing.
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        <PageHeader title="Projects" />
        <PhoneProjectList />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Projects" />

      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <FolderIcon className="size-8" />
          <p>Select a project from the list, or create a new one.</p>
        </div>
      </div>
    </>
  );
}
