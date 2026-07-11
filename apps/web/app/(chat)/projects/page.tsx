"use client";

import { FolderIcon } from "lucide-react";

import { PageHeader } from "../components/page-header";

// /projects index: the rail (ProjectListSidebar) carries the list; this pane
// just asks the user to pick or create one. Mirrors how "/" is the chats
// section's neutral landing.
export default function ProjectsPage() {
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
