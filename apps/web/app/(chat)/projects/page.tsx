"use client";

import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { FolderIcon } from "lucide-react";

import { topBarClasses } from "../components/top-bar";

// /projects index: the rail (ProjectListSidebar) carries the list; this pane
// just asks the user to pick or create one. Mirrors how "/" is the chats
// section's neutral landing.
export default function ProjectsPage() {
  return (
    <>
      <header className={cn(topBarClasses, "bg-background gap-2 px-2")}>
        {/* Mobile-only: opens the sidebar sheet, same as ChatHeader. */}
        <SidebarTrigger className="md:hidden" />
        <span className="pl-1 text-sm font-semibold">Projects</span>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <FolderIcon className="size-8" />
          <p>Select a project from the list, or create a new one.</p>
        </div>
      </div>
    </>
  );
}
