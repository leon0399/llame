"use client";

import * as React from "react";

import { useChatContext } from "@/contexts/chat-context";
import { useChatsQuery } from "@/lib/services/chat/queries";
import { useProjects } from "@/lib/services/project/queries";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { useParams } from "next/navigation";

import { ChatItem } from "../../components/chat-list-sidebar/chat-item";
import { topBarClasses } from "../../components/top-bar";

// Project page, first slice: header (project name) + the project's chats.
// The chat rows are the exact ChatItem used by the chats sidebar — same
// affordances (pin, menu, activity indicator), no parallel implementation.
// Description/stats/todos/knowledge come with later slices of the design.
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { setActiveChatId } = useChatContext();

  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data, isLoading: chatsLoading } = useChatsQuery();

  const allProjects = React.useMemo(() => projects ?? [], [projects]);
  const project = allProjects.find((candidate) => candidate.id === id);
  const projectChats = React.useMemo(
    () => (data?.pages.flat() ?? []).filter((chat) => chat.projectId === id),
    [data, id],
  );

  const loading = projectsLoading || chatsLoading;

  return (
    <>
      <header className={cn(topBarClasses, "bg-background gap-2 px-2")}>
        {/* Mobile-only: opens the sidebar sheet, same as ChatHeader. */}
        <SidebarTrigger className="md:hidden" />
        <span className="max-w-[60ch] truncate pl-1 text-sm font-semibold">
          {loading ? "…" : (project?.name ?? "Project not found")}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[820px]">
          {loading ? (
            <SidebarMenu>
              {Array.from({ length: 4 }).map((_, index) => (
                <SidebarMenuItem key={index}>
                  <SidebarMenuSkeleton />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : !project ? (
            <p className="text-sm text-muted-foreground">
              This project doesn&apos;t exist or was deleted.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-lg border p-3">
              <span className="px-2 pb-0.5 text-sm font-semibold">
                Chats in this project
              </span>
              {projectChats.length === 0 ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">
                  No chats in this project yet.
                </p>
              ) : (
                <SidebarMenu>
                  {projectChats.map((chat) => (
                    <ChatItem
                      key={chat.id}
                      chat={chat}
                      onSelect={setActiveChatId}
                      projects={allProjects}
                    />
                  ))}
                </SidebarMenu>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
