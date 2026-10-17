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
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import type { DragControls } from "framer-motion";
import { ChevronRightIcon, FolderIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChatItem } from "@/app/(chat)/components/chat-list-sidebar/chat-item";
import {
  useProjectDialogs,
  ProjectDialogs,
} from "@/app/(chat)/components/project-list-sidebar/project-actions";
import { ArchivedBadge } from "@/components/archived-badge";
import { SidebarRowTitle } from "@/components/sidebar-row-title";
import { useChatsQuery } from "@/lib/services/chat/queries";
import { useUnpinItem } from "@/lib/services/pins/mutations";
import { chatListFilters } from "@/app/(chat)/components/chat-list-view";
import type { PinnedItem } from "@/lib/services/pins/types";
import { useProjectQuery, useProjects } from "@/lib/services/project/queries";
import { useSetProjectArchive } from "@/lib/services/project/mutations";

import { PinDragHandle, PinRowMenu, PinRowSurface } from "./pinned-row-parts";

type PinnedProject = Extract<PinnedItem, { itemType: "project" }>;

const PROJECT_RECENT_CHAT_LIMIT = 5;

/** The folder icon doubles as the expand toggle: it turns into a chevron
 *  while the icon itself is hovered or focused, and stays a chevron, turned
 *  down, while the project is expanded (the trigger's `data-panel-open`). It
 *  sits outside the row's link, so toggling never navigates; the expanded
 *  state reaches assistive tech through the trigger's `aria-expanded`. An
 *  icon-only rail has no room for the chats, so there the toggle is gone and
 *  the link shows a plain folder instead. */
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
          className="group/toggle ml-1 -mr-1 shrink-0 group-data-[collapsible=icon]:hidden"
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
      {/* The icon-only rail's folder; the expand toggle carries it otherwise. */}
      <FolderIcon
        className={cn(
          "hidden group-data-[collapsible=icon]:block",
          isArchived && "opacity-50",
        )}
      />
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
 *  cache. */
function PinnedProjectChats({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const { data } = useChatsQuery(chatListFilters("active", projectId));
  const { data: projects } = useProjects();
  const chats = (data?.pages.flat() ?? []).slice(0, PROJECT_RECENT_CHAT_LIMIT);

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

/** The row's "…" menu. Unpin and archive-toggle need only the lean card;
 *  Edit details and Delete open the shared dialogs. */
function PinnedProjectMenu({
  pin,
  isActive,
  dialogs,
}: {
  pin: PinnedProject;
  isActive: boolean;
  dialogs: ReturnType<typeof useProjectDialogs>;
}) {
  const unpinMutation = useUnpinItem();
  const archiveMutation = useSetProjectArchive();
  const isArchived = pin.item.archivedAt !== null;
  return (
    <PinRowMenu
      isActive={isActive}
      onUnpin={() =>
        unpinMutation.mutate({ itemType: "project", itemId: pin.itemId })
      }
      edit={{
        label: "Edit details",
        icon: <PencilIcon />,
        onSelect: dialogs.openEdit,
      }}
      isArchived={isArchived}
      onToggleArchive={() =>
        archiveMutation.mutate({ id: pin.itemId, archived: !isArchived })
      }
      onDelete={dialogs.openDelete}
    />
  );
}

/** The rail holds only the pin's lean card, so Edit details reads the full
 *  project (its description) when it opens, and shows once that lands. */
function PinnedProjectDialogs({
  pin,
  dialogs,
}: {
  pin: PinnedProject;
  dialogs: ReturnType<typeof useProjectDialogs>;
}) {
  const { data: full } = useProjectQuery(pin.itemId, dialogs.editOpen);
  return (
    <ProjectDialogs
      project={full ?? { id: pin.itemId, name: pin.item.name }}
      dialogs={dialogs}
    />
  );
}

/** Expanded state that never outlives an icon-only rail: collapsing the rail
 *  collapses the project, and expanding the rail does not reopen it. */
function useProjectExpansion() {
  const { state, isMobile } = useSidebar();
  const iconOnly = state === "collapsed" && !isMobile;
  const [open, setOpen] = useState(false);
  const [wasIconOnly, setWasIconOnly] = useState(iconOnly);
  if (wasIconOnly !== iconOnly) {
    setWasIconOnly(iconOnly);
    if (iconOnly) setOpen(false);
  }
  return { open: open && !iconOnly, onOpenChange: setOpen };
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
  const dialogs = useProjectDialogs();
  const expansion = useProjectExpansion();

  return (
    <Collapsible {...expansion}>
      <PinRowSurface>
        <PinnedProjectToggle name={pin.item.name} isArchived={isArchived} />
        <PinnedProjectLabel
          pin={pin}
          isArchived={isArchived}
          isActive={isActive}
        />
        <PinDragHandle dragControls={dragControls} />
        <PinnedProjectMenu pin={pin} isActive={isActive} dialogs={dialogs} />
      </PinRowSurface>
      <CollapsibleContent>
        <PinnedProjectChats projectId={pin.itemId} />
      </CollapsibleContent>
      <PinnedProjectDialogs pin={pin} dialogs={dialogs} />
    </Collapsible>
  );
}
