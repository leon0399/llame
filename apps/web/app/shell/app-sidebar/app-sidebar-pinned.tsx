"use client";

import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@workspace/ui/components/sidebar";
import {
  ArchiveIcon,
  FolderIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PinOffIcon,
  TrashIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  DeleteChatDialog,
  RenameChatDialog,
} from "@/app/(chat)/components/app-sidebar/chat-item-dialogs";
import {
  DeleteProjectDialog,
  RenameProjectDialog,
} from "@/app/(chat)/components/chat-list-sidebar/project-dialogs";
import { useUnpinItem } from "@/lib/services/pins/mutations";
import { useSetChatArchive } from "@/lib/services/chat/management";
import { useSetProjectArchive } from "@/lib/services/project/mutations";
import type { PinnedItem } from "@/lib/services/pins/types";
import { usePins } from "@/lib/services/pins/queries";

// Placeholder for an untitled pinned chat (title === null, generation
// pending). Same literal as chat-item.tsx/command-palette.tsx's
// UNTITLED_CHAT_LABEL — kept local per this repo's convention of a
// per-render-site constant rather than a shared import.
const UNTITLED_CHAT_LABEL = "New chat";

type PinnedChat = Extract<PinnedItem, { itemType: "chat" }>;
type PinnedProject = Extract<PinnedItem, { itemType: "project" }>;

// Split into two small per-type row components (rather than a single row
// computing a shared `string` href) so each Link's href stays an inline
// template literal — matching the pattern next/link's typed routes accept
// elsewhere in this codebase (chat-item.tsx, project-list-sidebar/index.tsx).
//
// Every rail row here is, by construction, pinned (it only exists because
// it's in the pins list) — so the row's only action control is the "…" kebab
// (no separate hover pin/unpin button, unlike ChatItem/ProjectItem's list
// rows), and its toggle item is always "Unpin", never "Pin". The menu is
// grouped by action semantics exactly like its list-row counterpart: pin
// toggle → rename → lifecycle (archive, then delete).
// It's necessarily a SUBSET of the list row's menu — the rail holds only the
// lean RefCard (`{id,title|null}` / `{id,name}`), not the full chat/project,
// so data-heavy chat actions (Move to project, Share, Export, Fork) have no
// data to act on here and are deliberately omitted rather than faked.
function PinnedChatRow({ pin }: { pin: PinnedChat }) {
  const pathname = usePathname();
  const label = pin.item.title ?? UNTITLED_CHAT_LABEL;
  const isArchived = pin.item.archivedAt !== null;
  const isActive = pathname === `/chat/${pin.itemId}`;
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unpinMutation = useUnpinItem();
  const archiveMutation = useSetChatArchive();

  const unpin = () =>
    unpinMutation.mutate({ itemType: "chat", itemId: pin.itemId });

  return (
    <>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link href={`/chat/${pin.itemId}`}>
          <MessagesSquareIcon />
          <span className="truncate">{label}</span>
          {isArchived && (
            <span className="text-xs text-muted-foreground shrink-0">
              Archived
            </span>
          )}
        </Link>
      </SidebarMenuButton>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            showOnHover={!isActive}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={unpin}>
              <PinOffIcon />
              <span>Unpin</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => setTimeout(() => setRenameOpen(true), 0)}
            >
              <PenLineIcon />
              <span>Rename</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() =>
                archiveMutation.mutate({
                  id: pin.itemId,
                  archived: isArchived ? false : true,
                })
              }
            >
              <ArchiveIcon />
              <span>{isArchived ? "Unarchive" : "Archive"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setTimeout(() => setDeleteOpen(true), 0)}
            >
              <TrashIcon />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameChatDialog
        chat={{ id: pin.itemId, title: label }}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteChatDialog
        chat={{ id: pin.itemId, title: label }}
        isActive={isActive}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}

function PinnedProjectRow({ pin }: { pin: PinnedProject }) {
  const pathname = usePathname();
  const isActive = pathname === `/projects/${pin.itemId}`;
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unpinMutation = useUnpinItem();
  const archiveMutation = useSetProjectArchive();

  const unpin = () =>
    unpinMutation.mutate({ itemType: "project", itemId: pin.itemId });

  return (
    <>
      <SidebarMenuButton asChild isActive={isActive} tooltip={pin.item.name}>
        <Link href={`/projects/${pin.itemId}`}>
          <FolderIcon />
          <span className="truncate">{pin.item.name}</span>
        </Link>
      </SidebarMenuButton>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            showOnHover={!isActive}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={unpin}>
              <PinOffIcon />
              <span>Unpin</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => setTimeout(() => setRenameOpen(true), 0)}
            >
              <PenLineIcon />
              <span>Rename</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() =>
                archiveMutation.mutate({
                  id: pin.itemId,
                  archived: pin.item.archivedAt === null ? true : false,
                })
              }
            >
              <ArchiveIcon />
              <span>
                {pin.item.archivedAt === null ? "Archive" : "Unarchive"}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setTimeout(() => setDeleteOpen(true), 0)}
            >
              <TrashIcon />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProjectDialog
        project={{ id: pin.itemId, name: pin.item.name }}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteProjectDialog
        project={{ id: pin.itemId, name: pin.item.name }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}

/**
 * The rail's mixed chats+projects "Pinned" section (AppShell.dc.html) — one
 * unified list sourced straight from GET /pins (pins is the sole source of
 * pin state, design D5), rendered in server order (pinned_at DESC). Hidden
 * entirely when the caller has no pins — never an empty labelled group.
 */
export function AppSidebarPinned() {
  const { data: pins } = usePins();

  if (!pins || pins.length === 0) {
    return null;
  }

  return (
    <>
      {/* Divider from the nav items above — matches the separators between the
          rail's other groups (AppShell.dc.html). Rendered only alongside the
          section, so an empty pin set leaves no dangling divider. */}
      <SidebarSeparator className="mx-0" />
      <SidebarGroup>
        <SidebarGroupLabel>Pinned</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {pins.map((pin) => (
              <SidebarMenuItem key={`${pin.itemType}-${pin.itemId}`}>
                {pin.itemType === "chat" ? (
                  <PinnedChatRow pin={pin} />
                ) : (
                  <PinnedProjectRow pin={pin} />
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
