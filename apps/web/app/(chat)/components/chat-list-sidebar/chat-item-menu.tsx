"use client";

import { useState } from "react";
import {
  ArchiveIcon,
  DownloadIcon,
  FolderPlusIcon,
  GitForkIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  Share2Icon,
  TrashIcon,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { exportChatAsMarkdown } from "@/lib/services/chat/export";
import { useForkChat } from "@/lib/services/chat/fork";
import type { ChatResponse } from "@/lib/services/chat/queries";
import { useSetChatArchive } from "@/lib/services/chat/management";
import { filterProjectsByName } from "@/lib/services/project/filter";
import { useFileChat } from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";
import { SearchFilterInput } from "@/components/search-filter-input";
import { HoverReveal, SidebarRowAction } from "@/components/hover-reveal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { toast } from "@workspace/ui/components/sonner";

// Row menu, grouped by action semantics: quick pin toggle → chat metadata
// (name, project) → produce-something-new (share, export, fork) → lifecycle
// (reversible archive, then irreversible delete last). Pin, Rename, Move to
// project, Share, Export, Fork & Delete are wired; everything else stays a
// visible, disabled placeholder until its feature ships (never hidden, never
// a dead click).
// `id` is the stable dispatch key (matched in resolveChatMenuAction below);
// `label` is user-facing copy only — renaming/i18n never silently detaches a
// handler.
type ChatMenuAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
};

const CHAT_MENU_GROUPS: Array<Array<ChatMenuAction>> = [
  [{ id: "pin", label: "Pin", icon: PinIcon }],
  [
    { id: "rename", label: "Rename", icon: PenLineIcon },
    // Rendered as a select-like radio submenu; the visible label is dynamic
    // ("Add to project" when unfiled, "Change project" when filed).
    { id: "project", label: "Add to project", icon: FolderPlusIcon },
  ],
  [
    { id: "share", label: "Share", icon: Share2Icon },
    { id: "export", label: "Export as Markdown", icon: DownloadIcon },
    // Clones the WHOLE chat into a new one the caller owns — reuses the
    // per-message "fork from here" machinery with no anchor message. Same
    // icon + vocabulary as MessageForkButton (the per-message action) —
    // same machinery, same affordance identity.
    { id: "fork", label: "Fork", icon: GitForkIcon },
  ],
  [
    { id: "archive", label: "Archive", icon: ArchiveIcon },
    { id: "delete", label: "Delete", icon: TrashIcon, destructive: true },
  ],
];

/** Everything the menu's rows need, bundled so each row component takes one
 * prop instead of re-declaring the same handful of fields. */
type ChatMenuCtx = {
  chat: Pick<ChatResponse, "projectId">;
  projects: Array<ProjectResponse>;
  projectFilter: string;
  onFilterChange: (value: string) => void;
  onNewProject?: () => void;
  onFile: (projectId: string | null) => void;
  isPinned: boolean;
  isArchived: boolean;
  togglePin: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onExport: () => void;
  onFork: () => void;
  onArchiveToggle: () => void;
};

function exportChatHandler(chatId: string, title: string): () => void {
  return () => {
    void exportChatAsMarkdown(chatId, title).catch(() =>
      toast.error("Couldn't export the chat."),
    );
  };
}

/** No fromMessageId — clones the WHOLE chat, same mutation the per-message
 * fork uses. */
function forkChatHandler(
  chatId: string,
  forkMutation: ReturnType<typeof useForkChat>,
  router: ReturnType<typeof useRouter>,
): () => void {
  return () =>
    forkMutation.mutate(
      { chatId },
      { onSuccess: (forked) => router.push(`/chat/${forked.id}`) },
    );
}

function resolveChatMenuAction(
  actionId: string,
  ctx: ChatMenuCtx,
): (() => void) | undefined {
  switch (actionId) {
    case "pin":
      return ctx.togglePin;
    case "rename":
      return ctx.onRename;
    case "share":
      return ctx.onShare;
    case "export":
      return ctx.onExport;
    case "fork":
      return ctx.onFork;
    case "archive":
      return ctx.onArchiveToggle;
    case "delete":
      return ctx.onDelete;
    default:
      return undefined;
  }
}

function ProjectSearchFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <SearchFilterInput
        value={value}
        onChange={onChange}
        placeholder="Search projects…"
        // Keep typing local to the input: Radix menus typeahead-jump focus on
        // printable keys. Escape still propagates so it closes the menu as
        // everywhere else.
        onKeyDown={(event) => {
          if (event.key !== "Escape") {
            event.stopPropagation();
          }
        }}
      />
      <DropdownMenuSeparator />
    </>
  );
}

function ProjectRadioList({
  chat,
  allProjects,
  filteredProjects,
  onFile,
}: {
  chat: Pick<ChatResponse, "projectId">;
  allProjects: Array<ProjectResponse>;
  filteredProjects: Array<ProjectResponse>;
  onFile: (projectId: string | null) => void;
}) {
  if (allProjects.length === 0) {
    return <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>;
  }
  if (filteredProjects.length === 0) {
    return <DropdownMenuItem disabled>No projects found</DropdownMenuItem>;
  }
  return (
    <DropdownMenuRadioGroup
      value={chat.projectId ?? ""}
      onValueChange={(value) =>
        // Radix fires onValueChange even for the already-selected item —
        // that's the toggle-off: re-picking the current project unfiles it.
        onFile(value === chat.projectId ? null : value)
      }
    >
      {filteredProjects.map((project) => (
        <DropdownMenuRadioItem key={project.id} value={project.id}>
          <span className="truncate">{project.name}</span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function NewProjectMenuItem({
  onNewProject,
}: Pick<ChatMenuCtx, "onNewProject">) {
  return (
    <DropdownMenuItem
      disabled={!onNewProject}
      // Deferred open, same reasoning as Rename/Share/Delete below; the
      // caller owns ONE shared dialog and files this chat into the created
      // project.
      onSelect={onNewProject ? () => setTimeout(onNewProject, 0) : undefined}
    >
      <PlusIcon />
      <span>New project</span>
    </DropdownMenuItem>
  );
}

/** Combobox-shaped submenu: filter input on top, project radio list, then
 * "New project" at the bottom — a select-like way to move a chat between
 * projects (or unfile it by re-picking the current one). */
function MoveToProjectSubmenu({
  chat,
  projects,
  projectFilter,
  onFilterChange,
  onNewProject,
  onFile,
}: ChatMenuCtx) {
  const filteredProjects = filterProjectsByName(projects, projectFilter);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderPlusIcon />
        <span>
          {chat.projectId === null ? "Add to project" : "Change project"}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-56">
          {projects.length > 0 && (
            <ProjectSearchFilter
              value={projectFilter}
              onChange={onFilterChange}
            />
          )}
          <ProjectRadioList
            chat={chat}
            allProjects={projects}
            filteredProjects={filteredProjects}
            onFile={onFile}
          />
          <DropdownMenuSeparator />
          <NewProjectMenuItem onNewProject={onNewProject} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function ChatMenuActionItem({
  action,
  ...ctx
}: { action: ChatMenuAction } & ChatMenuCtx) {
  const onSelect = resolveChatMenuAction(action.id, ctx);
  const Icon = action.id === "pin" && ctx.isPinned ? PinOffIcon : action.icon;
  const label =
    action.id === "pin" && ctx.isPinned
      ? "Unpin"
      : action.id === "archive"
        ? ctx.isArchived
          ? "Unarchive"
          : "Archive"
        : action.label;

  return (
    <DropdownMenuItem
      disabled={!onSelect}
      onSelect={onSelect}
      variant={action.destructive ? "destructive" : "default"}
    >
      <Icon />
      <span>{label}</span>
    </DropdownMenuItem>
  );
}

function ChatMenuGroupRow({
  group,
  index,
  ...ctx
}: {
  group: Array<ChatMenuAction>;
  index: number;
} & ChatMenuCtx) {
  return (
    <DropdownMenuGroup>
      {index > 0 && <DropdownMenuSeparator />}
      {group.map((action) =>
        action.id === "project" ? (
          <MoveToProjectSubmenu key={action.id} {...ctx} />
        ) : (
          <ChatMenuActionItem key={action.id} action={action} {...ctx} />
        ),
      )}
    </DropdownMenuGroup>
  );
}

type ChatItemMenuProps = {
  chat: ChatResponse;
  title: string;
  isActive: boolean;
  isPinned: boolean;
  /** The caller's projects, for the "Move to project" submenu. */
  projects: Array<ProjectResponse>;
  /**
   * Opens the caller-owned "new project" dialog (one shared instance, not one
   * per row); the caller files this chat into the created project. Absent →
   * the submenu item renders disabled (never a dead click).
   */
  onNewProject?: () => void;
  togglePin: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
};

/** Builds the menu's action-dispatch context: the project-filter state plus
 * every row's click handler. Split out of `ChatItemMenu` so the component
 * below is composition only. */
function useChatMenuCtx({
  chat,
  title,
  isPinned,
  projects,
  onNewProject,
  togglePin,
  onRename,
  onShare,
  onDelete,
}: Omit<ChatItemMenuProps, "isActive">): ChatMenuCtx {
  const [projectFilter, setProjectFilter] = useState("");
  const archiveMutation = useSetChatArchive();
  const forkMutation = useForkChat();
  const fileChatMutation = useFileChat();
  const router = useRouter();

  // Let the dropdown close normally (no preventDefault — an always-open
  // dropdown lingering behind a modal dialog needs a stray extra click to
  // dismiss once the dialog closes) and defer the dialog open a tick, so its
  // mount doesn't race the dropdown's own close/unmount and focus-return.
  return {
    chat,
    projects,
    projectFilter,
    onFilterChange: setProjectFilter,
    onNewProject,
    onFile: (projectId) =>
      fileChatMutation.mutate({ chatId: chat.id, projectId }),
    isPinned,
    isArchived: chat.archivedAt !== null,
    togglePin,
    onRename: () => setTimeout(onRename, 0),
    onShare: () => setTimeout(onShare, 0),
    onDelete: () => setTimeout(onDelete, 0),
    onExport: exportChatHandler(chat.id, title),
    onFork: forkChatHandler(chat.id, forkMutation, router),
    onArchiveToggle: () =>
      archiveMutation.mutate({
        id: chat.id,
        archived: chat.archivedAt === null,
      }),
  };
}

/** The chat row's "..." overflow menu — pin, rename, move to project, share,
 * export, fork, archive, delete. Split out of `ChatItem` so the row and its
 * menu are each independently reviewable. */
export function ChatItemMenu({ isActive, ...props }: ChatItemMenuProps) {
  const ctx = useChatMenuCtx(props);

  return (
    <DropdownMenu
      modal={true}
      // Reset the project filter so reopening the menu starts unfiltered.
      onOpenChange={(open) => {
        if (!open) ctx.onFilterChange("");
      }}
    >
      {/* Always in layout on the active row (as on the pre-redesign list),
          hover-revealed elsewhere. */}
      <HoverReveal atRest={isActive}>
        <DropdownMenuTrigger render={<SidebarRowAction />}>
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </DropdownMenuTrigger>
      </HoverReveal>

      <DropdownMenuContent side="bottom" align="start">
        {CHAT_MENU_GROUPS.map((group, index) => (
          <ChatMenuGroupRow key={index} group={group} index={index} {...ctx} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
