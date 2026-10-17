"use client";

import * as React from "react";

import { type ChatResponse, useChatsQuery } from "@/lib/services/chat/queries";
import { selectPinnedChatMap, usePins } from "@/lib/services/pins/queries";
import { useProjects } from "@/lib/services/project/queries";
import type { ProjectResponse } from "@/lib/services/project/types";
import { useParams } from "next/navigation";

import {
  chatListFilters,
  type ChatListShow,
  ChatListShowChip,
  ChatListViewMenu,
  pinnedChatsFilters,
} from "../../components/chat-list-view";
import {
  ChatTimeGroups,
  PinnedChatGroup,
} from "../../components/chat-time-groups";
import { CreateProjectForChatDialog } from "../../components/chat-list-sidebar/project-dialogs";
import { PageHeader } from "../../components/page-header";
import { SidebarRowSkeletons } from "../../components/sidebar-row-skeletons";

const EMPTY_TEXT = new Map<ChatListShow, string>([
  ["active", "No chats in this project yet."],
  ["archived", "No archived chats in this project."],
  ["all", "No chats in this project yet."],
]);

type ProjectChatRows = {
  projects: Array<ProjectResponse>;
  pinnedAtByChatId: ReadonlyMap<string, string>;
  onRequestNewProject: (chatId: string) => void;
};

type ProjectChatsView = {
  show: ChatListShow;
  onShowChange: (show: ChatListShow) => void;
  /** Above the view's list in Active and All; none in Archived. */
  pinnedChats: Array<ChatResponse>;
  chats: Array<ChatResponse>;
  /** The current view's chats are loading (first load or a view switch). */
  loading: boolean;
};

/** The card's list region, laid out like the chats rail: a Pinned section,
 *  then the view's time groups. Only the time groups reload when the view
 *  changes. */
function ProjectChatsList({
  view,
  rows,
}: {
  view: ProjectChatsView;
  rows: ProjectChatRows;
}) {
  if (!view.loading && view.chats.length === 0 && view.pinnedChats.length === 0)
    return (
      <p className="px-2 py-1 text-sm text-muted-foreground">
        {EMPTY_TEXT.get(view.show)}
      </p>
    );
  // This card sits on the page canvas, not the sidebar.
  const surfaceClassName = "bg-background";
  return (
    <>
      <PinnedChatGroup
        chats={view.pinnedChats}
        {...rows}
        surfaceClassName={surfaceClassName}
      />
      {view.loading ? (
        <SidebarRowSkeletons count={4} />
      ) : (
        <ChatTimeGroups
          chats={view.chats}
          {...rows}
          surfaceClassName={surfaceClassName}
        />
      )}
    </>
  );
}

/** The "Chats in this project" card: the same view menu and grouped list as
 *  the chats rail, scoped to this project. */
function ProjectChatsCard({
  view,
  rows,
}: {
  view: ProjectChatsView;
  rows: ProjectChatRows;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex items-center gap-2 pl-2">
        <span className="flex-1 text-sm font-semibold">
          Chats in this project
        </span>
        <ChatListViewMenu show={view.show} onShowChange={view.onShowChange} />
      </div>
      <ChatListShowChip show={view.show} onShowChange={view.onShowChange} />
      <ProjectChatsList view={view} rows={rows} />
    </div>
  );
}

/** The project header, plus its chats for the card's current view. Only the
 *  project gates the page; the card owns its list's loading state. */
function useProjectPageData(id: string) {
  const [show, setShow] = React.useState<ChatListShow>("active");
  const { data: projects, isLoading } = useProjects();
  const { data: pinnedData } = useChatsQuery(pinnedChatsFilters(id));
  const { data, isLoading: chatsLoading } = useChatsQuery(
    chatListFilters(show, id),
  );
  const { data: pins } = usePins();

  const allProjects = React.useMemo(() => projects ?? [], [projects]);
  const pinnedChats = React.useMemo(
    () => (show === "archived" ? [] : (pinnedData?.pages.flat() ?? [])),
    [pinnedData, show],
  );
  const chats = React.useMemo(() => data?.pages.flat() ?? [], [data]);
  const pinnedAtByChatId = React.useMemo(
    () => selectPinnedChatMap(pins),
    [pins],
  );

  return {
    loading: isLoading,
    project: allProjects.find((candidate) => candidate.id === id),
    allProjects,
    pinnedAtByChatId,
    view: {
      show,
      onShowChange: setShow,
      pinnedChats,
      chats,
      loading: chatsLoading,
    },
  };
}

// Project page, first slice: header (project name) + the project's chats,
// grouped by pin/time exactly like the sidebar (shared ChatTimeGroups) and
// fetched server-filtered (GET /api/v1/chats?projectId=…) under its own
// query key — never a client-side pass over the full chat list.
// Description/stats/todos/knowledge come with later slices of the design.
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, project, allProjects, pinnedAtByChatId, view } =
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
        <div className="mx-auto max-w-205">
          {loading ? (
            <SidebarRowSkeletons count={4} />
          ) : !project ? (
            <p className="text-sm text-muted-foreground">
              This project doesn&apos;t exist or was deleted.
            </p>
          ) : (
            <ProjectChatsCard
              view={view}
              rows={{
                projects: allProjects,
                pinnedAtByChatId,
                onRequestNewProject: setNewProjectChatId,
              }}
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
