"use client";

import { useState } from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import type { DragControls } from "framer-motion";
import { ChevronRightIcon, FolderIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChatItem } from "@/app/(chat)/components/chat-list-sidebar/chat-item";
import {
  DeleteProjectDialog,
  RenameProjectDialog,
} from "@/app/(chat)/components/chat-list-sidebar/project-dialogs";
import { ArchivedBadge } from "@/components/archived-badge";
import { SidebarRowTitle } from "@/components/sidebar-row-title";
import { useChatsQuery } from "@/lib/services/chat/queries";
import { useUnpinItem } from "@/lib/services/pins/mutations";
import { selectPinnedChatMap, usePins } from "@/lib/services/pins/queries";
import type { PinnedItem } from "@/lib/services/pins/types";
import { useProjects } from "@/lib/services/project/queries";
import { useSetProjectArchive } from "@/lib/services/project/mutations";

import { PinDragHandle, PinRowMenu, PinRowSurface } from "./pinned-row-parts";

type PinnedProject = Extract<PinnedItem, { itemType: "project" }>;

const PROJECT_RECENT_CHAT_LIMIT = 5;

/** The folder icon doubles as the expand toggle: it turns into a chevron
 *  while the icon itself is hovered or focused, and stays a chevron, turned
 *  down, while the project is expanded (the trigger's `data-panel-open`). It
 *  sits outside the row's link, so toggling never navigates; the expanded
 *  state reaches assistive tech through the trigger's `aria-expanded`. */
function PinnedProjectToggle({
  name,
  isArchived,
}: {
  name: string;
  isArchived: boolean;
}) {
  return (
    <CollapsibleTrigger
      render={
        <Button
          variant="ghost"
          size="icon-xs"
          // Centres the icon where the row's own icon sits; the negative
          // margin gives the label back the space the button adds.
          className="group/toggle ml-1 -mr-1 shrink-0"
        />
      }
    >
      <FolderIcon
        className={cn(
          "size-4 group-hover/toggle:hidden group-focus-visible/toggle:hidden group-data-panel-open/toggle:hidden",
          isArchived && "opacity-50",
        )}
      />
      <ChevronRightIcon className="hidden size-4 transition-transform group-hover/toggle:block group-focus-visible/toggle:block group-data-panel-open/toggle:block group-data-panel-open/toggle:rotate-90" />
      <span className="sr-only">{`Recent chats in ${name}`}</span>
    </CollapsibleTrigger>
  );
}

function PinnedProjectLabel({
  pin,
  isArchived,
  isActive,
}: {
  pin: PinnedProject;
  isArchived: boolean;
  isActive: boolean;
}) {
  return (
    <SidebarMenuButton
      className="min-w-0 flex-1"
      variant="chromeless"
      render={<Link href={`/projects/${pin.itemId}`} />}
      isActive={isActive}
      tooltip={pin.item.name}
    >
      {/* Wrapper takes the primitive's truncate rule, not the title. */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <SidebarRowTitle
          text={pin.item.name}
          animateChanges
          className={cn(isArchived && "text-muted-foreground")}
        />
        {isArchived && <ArchivedBadge />}
      </span>
    </SidebarMenuButton>
  );
}

/** An expanded pinned project's newest non-archived, unpinned chats — the
 *  same rows the chats list renders, indented under the project — then
 *  "View all" to the project page. Pinned chats are left out: the rail
 *  already lists them above. Mounted only while expanded, so a collapsed
 *  project costs no request; it shares the project page's Active list
 *  cache, filtered here rather than with `?pinned=exclude` so the two keep
 *  one entry. */
function PinnedProjectChats({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const { data } = useChatsQuery({ projectId });
  const { data: pins } = usePins();
  const { data: projects } = useProjects();
  const pinned = selectPinnedChatMap(pins);
  const chats = (data?.pages.flat() ?? [])
    .filter((chat) => !pinned.has(chat.id))
    .slice(0, PROJECT_RECENT_CHAT_LIMIT);

  return (
    <div className="pl-4">
      <SidebarMenu>
        {chats.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            isActive={pathname === `/chat/${chat.id}`}
            projects={projects ?? []}
            isPinned={false}
          />
        ))}
        <SidebarMenuItem>
          <SidebarMenuButton render={<Link href={`/projects/${projectId}`} />}>
            <span className="text-muted-foreground">View all</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}

/** The row's mutations and dialog-open state — split out so
 *  `PinnedProjectRow` composes only markup. */
function usePinnedProjectActions(pin: PinnedProject) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unpinMutation = useUnpinItem();
  const archiveMutation = useSetProjectArchive();

  return {
    renameOpen,
    setRenameOpen,
    deleteOpen,
    setDeleteOpen,
    unpin: () =>
      unpinMutation.mutate({ itemType: "project", itemId: pin.itemId }),
    startRename: () => setTimeout(() => setRenameOpen(true), 0),
    toggleArchive: () =>
      archiveMutation.mutate({
        id: pin.itemId,
        archived: pin.item.archivedAt === null,
      }),
    startDelete: () => setTimeout(() => setDeleteOpen(true), 0),
  };
}

function PinnedProjectDialogs({
  pin,
  actions,
}: {
  pin: PinnedProject;
  actions: ReturnType<typeof usePinnedProjectActions>;
}) {
  const project = { id: pin.itemId, name: pin.item.name };
  return (
    <>
      <RenameProjectDialog
        project={project}
        open={actions.renameOpen}
        onOpenChange={actions.setRenameOpen}
      />
      <DeleteProjectDialog
        project={project}
        open={actions.deleteOpen}
        onOpenChange={actions.setDeleteOpen}
      />
    </>
  );
}

/** A pinned project: its row, and below it — once expanded from the folder
 *  icon — its recent chats. */
export function PinnedProjectRow({
  pin,
  dragControls,
}: {
  pin: PinnedProject;
  dragControls: DragControls;
}) {
  const isActive = usePathname() === `/projects/${pin.itemId}`;
  const isArchived = pin.item.archivedAt !== null;
  const actions = usePinnedProjectActions(pin);

  return (
    <Collapsible>
      <PinRowSurface>
        <PinnedProjectToggle name={pin.item.name} isArchived={isArchived} />
        <PinnedProjectLabel
          pin={pin}
          isArchived={isArchived}
          isActive={isActive}
        />
        <PinDragHandle dragControls={dragControls} />
        <PinRowMenu
          isActive={isActive}
          onUnpin={actions.unpin}
          onRename={actions.startRename}
          isArchived={isArchived}
          onToggleArchive={actions.toggleArchive}
          onDelete={actions.startDelete}
        />
      </PinRowSurface>
      <CollapsibleContent>
        <PinnedProjectChats projectId={pin.itemId} />
      </CollapsibleContent>
      <PinnedProjectDialogs pin={pin} actions={actions} />
    </Collapsible>
  );
}
