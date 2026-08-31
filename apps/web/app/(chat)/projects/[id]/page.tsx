"use client";

import * as React from "react";

import { type ChatResponse, useChatsQuery } from "@/lib/services/chat/queries";
import { selectPinnedChatMap, usePins } from "@/lib/services/pins/queries";
import { useProjects } from "@/lib/services/project/queries";
import type { ProjectResponse } from "@/lib/services/project/types";
import { useParams } from "next/navigation";

import { ChatTimeGroups } from "../../components/chat-time-groups";
import { CreateProjectForChatDialog } from "../../components/chat-list-sidebar/project-dialogs";
import { PageHeader } from "../../components/page-header";
import { SidebarRowSkeletons } from "../../components/sidebar-row-skeletons";

/** The "Chats in this project" card: empty state or the grouped chat list. */
function ProjectChatsCard({
  chats,
  projects,
  pinnedAtByChatId,
  onRequestNewProject,
}: {
  chats: Array<ChatResponse>;
  projects: Array<ProjectResponse>;
  pinnedAtByChatId: ReadonlyMap<string, string>;
  onRequestNewProject: (chatId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <span className="px-2 pb-0.5 text-sm font-semibold">
        Chats in this project
      </span>
      {chats.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted-foreground">
          No chats in this project yet.
        </p>
      ) : (
        <ChatTimeGroups
          chats={chats}
          projects={projects}
          onRequestNewProject={onRequestNewProject}
          pinnedAtByChatId={pinnedAtByChatId}
        />
      )}
    </div>
  );
}

/** The project header + its chats, fetched server-filtered by `projectId`. */
function useProjectPageData(id: string) {
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data, isLoading: chatsLoading } = useChatsQuery({ projectId: id });
  const { data: pins } = usePins();

  const allProjects = React.useMemo(() => projects ?? [], [projects]);
  const project = allProjects.find((candidate) => candidate.id === id);
  const projectChats = React.useMemo(() => data?.pages.flat() ?? [], [data]);
  const pinnedAtByChatId = React.useMemo(
    () => selectPinnedChatMap(pins),
    [pins],
  );

  return {
    loading: projectsLoading || chatsLoading,
    project,
    allProjects,
    projectChats,
    pinnedAtByChatId,
  };
}

// Project page, first slice: header (project name) + the project's chats,
// grouped by pin/time exactly like the sidebar (shared ChatTimeGroups) and
// fetched server-filtered (GET /api/v1/chats?projectId=…) under its own
// query key — never a client-side pass over the full chat list.
// Description/stats/todos/knowledge come with later slices of the design.
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, project, allProjects, projectChats, pinnedAtByChatId } =
    useProjectPageData(id);
  const [newProjectChatId, setNewProjectChatId] = React.useState<string | null>(
    null,
  );

  return (
    <>
      <PageHeader
        title={loading ? "…" : (project?.name ?? "Project not found")}
      />

      <div className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[820px]">
          {loading ? (
            <SidebarRowSkeletons count={4} />
          ) : !project ? (
            <p className="text-sm text-muted-foreground">
              This project doesn&apos;t exist or was deleted.
            </p>
          ) : (
            <ProjectChatsCard
              chats={projectChats}
              projects={allProjects}
              onRequestNewProject={setNewProjectChatId}
              pinnedAtByChatId={pinnedAtByChatId}
            />
          )}
        </div>
      </div>

      <CreateProjectForChatDialog
        chatId={newProjectChatId}
        onClose={() => setNewProjectChatId(null)}
      />
    </>
  );
}
