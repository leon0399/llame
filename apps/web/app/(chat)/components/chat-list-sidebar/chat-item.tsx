"use client";

import { useState } from "react";

import { useActiveRuns } from "@/contexts/active-runs-context";
import { exportChatAsMarkdown } from "@/lib/services/chat/export";
import { useForkChat } from "@/lib/services/chat/fork";
import type { ChatResponse } from "@/lib/services/chat/queries";
import { useSetChatArchive } from "@/lib/services/chat/management";
import { usePinItem, useUnpinItem } from "@/lib/services/pins/mutations";
import { filterProjectsByName } from "@/lib/services/project/filter";
import { useFileChat } from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";
import { SearchFilterInput } from "@/components/search-filter-input";
import {
  DeleteChatDialog,
  RenameChatDialog,
} from "../app-sidebar/chat-item-dialogs";
import {
  ChatActivityIndicator,
  resolveChatActivityStatus,
} from "./chat-activity-indicator";
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
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { toast } from "@workspace/ui/components/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  ArchiveIcon,
  DownloadIcon,
  FolderPlusIcon,
  GitForkIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  Share2Icon,
  TrashIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ShareChatDialog } from "./share-chat-dialog";

// Placeholder for untitled chats (title === null, generation pending). Client-owned
// so it can be localized without touching stored data.
const UNTITLED_CHAT_LABEL = "New chat";

// Row menu, grouped by action semantics: quick pin toggle → chat metadata
// (name, project) → produce-something-new (share, export, fork) → lifecycle
// (reversible archive, then irreversible delete last). Pin, Rename, Move to
// project, Share, Export, Fork & Delete are wired; everything else stays a
// visible, disabled placeholder until its feature ships (never hidden, never
// a dead click).
// `id` is the stable dispatch key (matched in the render switch below);
// `label` is user-facing copy only — renaming/i18n never silently detaches a
// handler.
const CHAT_MENU_GROUPS: {
  id: string;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
}[][] = [
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

export function ChatItem({
  chat,
  isActive = false,
  onSelect,
  projects = [],
  onNewProject,
  isPinned = false,
}: {
  chat: ChatResponse;
  isActive?: boolean;
  onSelect: (chatId: string) => void;
  /** The caller's projects, for the row menu's "Move to project" submenu. */
  projects?: ProjectResponse[];
  /**
   * Opens the caller-owned "new project" dialog (one shared instance, not one
   * per row); the caller files this chat into the created project. Absent →
   * the submenu item renders disabled (never a dead click).
   */
  onNewProject?: () => void;
  /**
   * From the caller's `usePins()` (pins is the sole source of pin state,
   * design D5) — this chat carries no pin field of its own.
   */
  isPinned?: boolean;
}) {
  const excerpt = chat.lastMessage;
  const { completedChats, activeChatIds } = useActiveRuns();
  const activityStatus = resolveChatActivityStatus({
    processing: activeChatIds.has(chat.id),
    unread: completedChats.has(chat.id),
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const filteredProjects = filterProjectsByName(projects, projectFilter);
  const title = chat.title ?? UNTITLED_CHAT_LABEL;
  const pinMutation = usePinItem();
  const unpinMutation = useUnpinItem();
  const archiveMutation = useSetChatArchive();
  const forkMutation = useForkChat();
  const fileChatMutation = useFileChat();
  const router = useRouter();

  // Unified pin resource (design D2): PUT to pin, DELETE to unpin, keyed by
  // itemType+itemId. Pinning synthesizes a card from the chat already on
  // screen (design D5a) — the rail can render it before the server responds.
  const togglePin = () =>
    isPinned
      ? unpinMutation.mutate({ itemType: "chat", itemId: chat.id })
      : pinMutation.mutate({
          itemType: "chat",
          itemId: chat.id,
          card: { id: chat.id, title: chat.title, archivedAt: chat.archivedAt },
        });

  return (
    <SidebarMenuItem>
      {/* Widen the primitive's single-action pr-8 to fit the two row controls. */}
      <SidebarMenuButton
        className="h-auto py-1.5 group-has-data-[sidebar=menu-action]/menu-item:pr-12"
        isActive={isActive}
        asChild
      >
        <Link href={`/chat/${chat.id}`} onNavigate={() => onSelect(chat.id)}>
          <span className="relative flex shrink-0 items-center">
            {/* SidebarMenuButton's own [&>svg]:size-4 rule only reaches a
                DIRECT child <svg> — nesting the icon inside this wrapper
                (for the badge's position:relative anchor) took it out from
                under that rule, so the size has to be explicit here now. */}
            <MessagesSquareIcon className="text-muted-foreground size-4" />
            <ChatActivityIndicator status={activityStatus} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{title}</span>
            {excerpt && (
              <span className="truncate text-xs text-muted-foreground">
                {excerpt}
              </span>
            )}
          </span>
        </Link>
      </SidebarMenuButton>

      {/* The rows are two lines tall; top-1/2! outweighs the primitive's
          per-size compound selectors (peer-data-[size=…]:top-*) to re-center. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            showOnHover={!isPinned}
            className="top-1/2! right-7 -translate-y-1/2"
            onClick={togglePin}
          >
            {isPinned ? <PinOffIcon /> : <PinIcon />}
            <span className="sr-only">{isPinned ? "Unpin" : "Pin"}</span>
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent>{isPinned ? "Unpin" : "Pin"}</TooltipContent>
      </Tooltip>

      <DropdownMenu
        modal={true}
        // Reset the project filter so reopening the menu starts unfiltered.
        onOpenChange={(open) => {
          if (!open) setProjectFilter("");
        }}
      >
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            // Always visible on the active row (as on the pre-redesign list),
            // hover-revealed elsewhere.
            showOnHover={!isActive}
            className="top-1/2! -translate-y-1/2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="start">
          {CHAT_MENU_GROUPS.map((group, index) => (
            <DropdownMenuGroup key={index}>
              {index > 0 && <DropdownMenuSeparator />}
              {group.map((action) => {
                // The one non-uniform entry: a select-like radio submenu, not
                // a plain onSelect action. Unfiled chat → "Add to project";
                // filed chat → "Change project" with the current project
                // marked, and re-selecting the marked project unfiles the
                // chat (toggle-off) — no separate "Remove from project" item.
                if (action.id === "project") {
                  return (
                    <DropdownMenuSub key={action.id}>
                      <DropdownMenuSubTrigger>
                        <FolderPlusIcon />
                        <span>
                          {chat.projectId === null
                            ? "Add to project"
                            : "Change project"}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        {/* Combobox-shaped submenu: filter input on top and
                            "New project" at the bottom, each divided from the
                            project radio list by a separator. */}
                        <DropdownMenuSubContent className="w-56">
                          {projects.length > 0 && (
                            <>
                              <SearchFilterInput
                                value={projectFilter}
                                onChange={setProjectFilter}
                                placeholder="Search projects…"
                                // Keep typing local to the input: Radix menus
                                // typeahead-jump focus on printable keys.
                                // Escape still propagates so it closes the
                                // menu as everywhere else.
                                onKeyDown={(event) => {
                                  if (event.key !== "Escape") {
                                    event.stopPropagation();
                                  }
                                }}
                              />
                              <DropdownMenuSeparator />
                            </>
                          )}
                          {projects.length === 0 ? (
                            <DropdownMenuItem disabled>
                              No projects yet
                            </DropdownMenuItem>
                          ) : filteredProjects.length === 0 ? (
                            <DropdownMenuItem disabled>
                              No projects found
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuRadioGroup
                              value={chat.projectId ?? ""}
                              onValueChange={(value) =>
                                fileChatMutation.mutate({
                                  chatId: chat.id,
                                  // Radix fires onValueChange even for the
                                  // already-selected item — that's the
                                  // toggle-off: re-picking the current
                                  // project unfiles the chat.
                                  projectId:
                                    value === chat.projectId ? null : value,
                                })
                              }
                            >
                              {filteredProjects.map((project) => (
                                <DropdownMenuRadioItem
                                  key={project.id}
                                  value={project.id}
                                >
                                  <span className="truncate">
                                    {project.name}
                                  </span>
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={!onNewProject}
                            // Deferred open, same reasoning as Rename below;
                            // the caller owns ONE shared dialog and files
                            // this chat into the created project.
                            onSelect={
                              onNewProject
                                ? () => setTimeout(onNewProject, 0)
                                : undefined
                            }
                          >
                            <PlusIcon />
                            <span>New project</span>
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                  );
                }

                const onSelect =
                  action.id === "pin"
                    ? togglePin
                    : action.id === "rename"
                        ? () =>
                            // Let the dropdown close normally (no preventDefault
                            // — an always-open dropdown lingering behind the
                            // modal dialog needs a stray extra click to dismiss
                            // once the dialog closes) and defer the dialog open
                            // a tick, so its mount doesn't race the dropdown's
                            // own close/unmount and focus-return.
                            setTimeout(() => setRenameOpen(true), 0)
                        : action.id === "share"
                          ? () => setTimeout(() => setShareOpen(true), 0)
                              : action.id === "export"
                                ? () => {
                                    void exportChatAsMarkdown(chat.id, title).catch(
                                      () =>
                                        toast.error("Couldn't export the chat."),
                                    );
                                  }
                                  : action.id === "fork"
                                    ? () =>
                                        // No fromMessageId — clones the WHOLE chat,
                                        // same mutation the per-message fork uses.
                                        forkMutation.mutate(
                                          { chatId: chat.id },
                                          {
                                            onSuccess: (forked) =>
                                              router.push(`/chat/${forked.id}`),
                                          },
                                        )
                                    : action.id === "archive"
                                ? () =>
                                    archiveMutation.mutate({
                                      id: chat.id,
                                      archived:
                                        chat.archivedAt === null
                                          ? true
                                          : false,
                                    })
                                : action.id === "delete"
                                  ? () =>
                                      setTimeout(() => setDeleteOpen(true), 0)
                                  : undefined;

                const Icon =
                  action.id === "pin" && isPinned ? PinOffIcon : action.icon;
                const label =
                  action.id === "pin" && isPinned
                    ? "Unpin"
                    : action.id === "archive"
                      ? chat.archivedAt === null
                        ? "Archive"
                        : "Unarchive"
                      : action.label;

                return (
                  <DropdownMenuItem
                    key={action.id}
                    disabled={!onSelect}
                    onSelect={onSelect}
                    variant={action.destructive ? "destructive" : "default"}
                  >
                    <Icon />
                    <span>{label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ShareChatDialog
        chat={{ id: chat.id, visibility: chat.visibility }}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
      <RenameChatDialog
        chat={{ id: chat.id, title }}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteChatDialog
        chat={{ id: chat.id, title }}
        isActive={isActive}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </SidebarMenuItem>
  );
}
