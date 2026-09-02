"use client";

import { useEffect, useRef, useState } from "react";

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
  SidebarMenuButton,
  SidebarSeparator,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { Reorder, useDragControls, type DragControls } from "framer-motion";
import {
  ArchiveIcon,
  FolderIcon,
  GripVerticalIcon,
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
import { useReorderPins, useUnpinItem } from "@/lib/services/pins/mutations";
import { useSetChatArchive } from "@/lib/services/chat/management";
import { useSetProjectArchive } from "@/lib/services/project/mutations";
import type { PinnedItem } from "@/lib/services/pins/types";
import { usePins } from "@/lib/services/pins/queries";
import { useOptionalActiveRuns } from "@/contexts/active-runs-context";
import { ArchivedBadge } from "@/components/archived-badge";
import { HoverReveal, SidebarRowAction } from "@/components/hover-reveal";
import { SidebarRowTitle } from "@/components/sidebar-row-title";

// Placeholder for an untitled pinned chat (title === null, generation
// pending). Same literal as chat-item.tsx/command-palette.tsx's
// UNTITLED_CHAT_LABEL — kept local per this repo's convention of a
// per-render-site constant rather than a shared import.
const UNTITLED_CHAT_LABEL = "New chat";

type PinnedChat = Extract<PinnedItem, { itemType: "chat" }>;
type PinnedProject = Extract<PinnedItem, { itemType: "project" }>;

function pinKey(pin: PinnedItem): string {
  return `${pin.itemType}-${pin.itemId}`;
}

/** Trailing drag handle — same HoverReveal expand as other row actions. */
function PinDragHandle({ dragControls }: { dragControls: DragControls }) {
  return (
    <HoverReveal>
      <SidebarRowAction
        aria-label="Drag to reorder"
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          event.preventDefault();
          dragControls.start(event);
        }}
      >
        <GripVerticalIcon />
      </SidebarRowAction>
    </HoverReveal>
  );
}

// Split into two small per-type row components (rather than a single row
// computing a shared `string` href) so each Link's href stays an inline
// template literal — matching the pattern next/link's typed routes accept
// elsewhere in this codebase (chat-item.tsx, project-list-sidebar/index.tsx).
//
// Every rail row here is, by construction, pinned (it only exists because
// it's in the pins list) — so the row's action controls are the drag handle
// and the "…" kebab (no separate hover pin/unpin button, unlike
// ChatItem/ProjectItem's list rows), and its toggle item is always "Unpin",
// never "Pin". The menu is grouped by action semantics exactly like its
// list-row counterpart: pin toggle → rename → lifecycle (archive, then
// delete). It's necessarily a SUBSET of the list row's menu — the rail holds
// only the lean RefCard (`{id,title|null}` / `{id,name}`), not the full
// chat/project, so data-heavy chat actions (Move to project, Share, Export,
// Fork) have no data to act on here and are deliberately omitted rather than
// faked. Run status is the exception to that rule rather than a break from
// it: it comes from the active-runs context keyed by chat id, not from the
// card, so a pinned chat can say it is still being named without anything
// being faked — and it is read optionally, because the admin shell mounts
// this rail with no runs provider at all.

type PinRowMenuProps = {
  isActive: boolean;
  onUnpin: () => void;
  onRename: () => void;
  isArchived: boolean;
  onToggleArchive: () => void;
  onDelete: () => void;
};

/** The lifecycle group (archive toggle, then delete) — the menu's own
 *  "danger zone", split out from the pin/rename actions above it. */
function PinRowLifecycleGroup({
  isArchived,
  onToggleArchive,
  onDelete,
}: {
  isArchived: boolean;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem onSelect={onToggleArchive}>
        <ArchiveIcon />
        <span>{isArchived ? "Unarchive" : "Archive"}</span>
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={onDelete}>
        <TrashIcon />
        <span>Delete</span>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

/** The kebab menu shape both row types share (Unpin → Rename → Archive/
 *  Delete) — split out so each row composes only its own label and dialogs. */
function PinRowMenu({
  isActive,
  onUnpin,
  onRename,
  isArchived,
  onToggleArchive,
  onDelete,
}: PinRowMenuProps) {
  return (
    <DropdownMenu modal={true}>
      <HoverReveal atRest={isActive}>
        <DropdownMenuTrigger render={<SidebarRowAction />}>
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </DropdownMenuTrigger>
      </HoverReveal>
      <DropdownMenuContent side="bottom" align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onUnpin}>
            <PinOffIcon />
            <span>Unpin</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onRename}>
            <PenLineIcon />
            <span>Rename</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <PinRowLifecycleGroup
          isArchived={isArchived}
          onToggleArchive={onToggleArchive}
          onDelete={onDelete}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PinnedChatLabel({
  pin,
  label,
  isArchived,
  isActive,
  activeRuns,
}: {
  pin: PinnedChat;
  label: string;
  isArchived: boolean;
  isActive: boolean;
  activeRuns: ReturnType<typeof useOptionalActiveRuns>;
}) {
  return (
    <SidebarMenuButton
      className="min-w-0 flex-1 hover:bg-transparent focus-visible:ring-0 active:bg-transparent data-active:bg-transparent"
      render={<Link href={`/chat/${pin.itemId}`} />}
      isActive={isActive}
      tooltip={label}
    >
      {/* Archived rows read as de-emphasized (mock's
          `.pin-item[data-archived]` icon opacity + muted title). */}
      <MessagesSquareIcon className={cn(isArchived && "opacity-50")} />
      {/* Wrapper so the row's `[&>span:last-child]:truncate` rule lands here
          and not on the title, which fades rather than ellipses. */}
      <span className="flex min-w-0 flex-1 items-center gap-[.35rem]">
        <SidebarRowTitle
          text={label}
          animateChanges
          // Same condition as the list row: a placeholder standing in for a
          // name a run is still producing.
          shimmer={
            pin.item.title === null &&
            (activeRuns?.activeChatIds.has(pin.itemId) ?? false)
          }
          className={cn(isArchived && "text-muted-foreground")}
        />
        {isArchived && <ArchivedBadge />}
      </span>
    </SidebarMenuButton>
  );
}

function PinnedChatDialogs({
  chat,
  isActive,
  renameOpen,
  onRenameOpenChange,
  deleteOpen,
  onDeleteOpenChange,
}: {
  chat: { id: string; title: string };
  isActive: boolean;
  renameOpen: boolean;
  onRenameOpenChange: (open: boolean) => void;
  deleteOpen: boolean;
  onDeleteOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <RenameChatDialog
        chat={chat}
        open={renameOpen}
        onOpenChange={onRenameOpenChange}
      />
      <DeleteChatDialog
        chat={chat}
        isActive={isActive}
        open={deleteOpen}
        onOpenChange={onDeleteOpenChange}
      />
    </>
  );
}

/** The row's mutations and dialog-open state — split out so `PinnedChatRow`
 *  composes only markup. */
function usePinnedChatActions(pin: PinnedChat, isArchived: boolean) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unpinMutation = useUnpinItem();
  const archiveMutation = useSetChatArchive();

  return {
    renameOpen,
    setRenameOpen,
    deleteOpen,
    setDeleteOpen,
    unpin: () => unpinMutation.mutate({ itemType: "chat", itemId: pin.itemId }),
    startRename: () => setTimeout(() => setRenameOpen(true), 0),
    toggleArchive: () =>
      archiveMutation.mutate({
        id: pin.itemId,
        archived: isArchived ? false : true,
      }),
    startDelete: () => setTimeout(() => setDeleteOpen(true), 0),
  };
}

type PinnedRowProps<TPin> = {
  pin: TPin;
  dragControls: DragControls;
};

export function PinnedChatRow({
  pin,
  dragControls,
}: PinnedRowProps<PinnedChat>) {
  const pathname = usePathname();
  const label = pin.item.title ?? UNTITLED_CHAT_LABEL;
  const isArchived = pin.item.archivedAt !== null;
  const isActive = pathname === `/chat/${pin.itemId}`;
  // Optional: the admin shell mounts this rail without the runs provider, and
  // there "nothing is running here" is the honest answer rather than a crash.
  const activeRuns = useOptionalActiveRuns();
  const actions = usePinnedChatActions(pin, isArchived);

  return (
    <>
      <PinnedChatLabel
        pin={pin}
        label={label}
        isArchived={isArchived}
        isActive={isActive}
        activeRuns={activeRuns}
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

      <PinnedChatDialogs
        chat={{ id: pin.itemId, title: label }}
        isActive={isActive}
        renameOpen={actions.renameOpen}
        onRenameOpenChange={actions.setRenameOpen}
        deleteOpen={actions.deleteOpen}
        onDeleteOpenChange={actions.setDeleteOpen}
      />
    </>
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
      className="min-w-0 flex-1 hover:bg-transparent focus-visible:ring-0 active:bg-transparent data-active:bg-transparent"
      render={<Link href={`/projects/${pin.itemId}`} />}
      isActive={isActive}
      tooltip={pin.item.name}
    >
      {/* Archived rows read as de-emphasized (mock's
          `.pin-item[data-archived]` icon opacity + muted title). */}
      <FolderIcon className={cn(isArchived && "opacity-50")} />
      {/* See PinnedChatRow: wrapper takes the primitive's truncate rule. */}
      <span className="flex min-w-0 flex-1 items-center gap-[.35rem]">
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

function PinnedProjectDialogs({
  project,
  renameOpen,
  onRenameOpenChange,
  deleteOpen,
  onDeleteOpenChange,
}: {
  project: { id: string; name: string };
  renameOpen: boolean;
  onRenameOpenChange: (open: boolean) => void;
  deleteOpen: boolean;
  onDeleteOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <RenameProjectDialog
        project={project}
        open={renameOpen}
        onOpenChange={onRenameOpenChange}
      />
      <DeleteProjectDialog
        project={project}
        open={deleteOpen}
        onOpenChange={onDeleteOpenChange}
      />
    </>
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

export function PinnedProjectRow({
  pin,
  dragControls,
}: {
  pin: PinnedProject;
  dragControls: DragControls;
}) {
  const pathname = usePathname();
  const isActive = pathname === `/projects/${pin.itemId}`;
  const isArchived = pin.item.archivedAt !== null;
  const actions = usePinnedProjectActions(pin);

  return (
    <>
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

      <PinnedProjectDialogs
        project={{ id: pin.itemId, name: pin.item.name }}
        renameOpen={actions.renameOpen}
        onRenameOpenChange={actions.setRenameOpen}
        deleteOpen={actions.deleteOpen}
        onDeleteOpenChange={actions.setDeleteOpen}
      />
    </>
  );
}

function SortablePinnedRow({
  pin,
  onDragStart,
  onReorderCommit,
}: {
  pin: PinnedItem;
  onDragStart: () => void;
  onReorderCommit: () => void;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      as="li"
      value={pin}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={onDragStart}
      onDragEnd={onReorderCommit}
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className="group/menu-item relative flex items-center rounded-md pr-1 hover:bg-sidebar-accent has-data-active:bg-sidebar-accent has-[a:focus-visible]:inset-ring-2 has-[a:focus-visible]:inset-ring-sidebar-ring"
    >
      {pin.itemType === "chat" ? (
        <PinnedChatRow pin={pin} dragControls={dragControls} />
      ) : (
        <PinnedProjectRow pin={pin} dragControls={dragControls} />
      )}
    </Reorder.Item>
  );
}

/** The reorderable local mirror of `pins` plus its commit-on-drag-end
 *  logic — split out so `AppSidebarPinned` composes only markup. */
function useReorderablePins(pins: Array<PinnedItem> | undefined) {
  const reorderMutation = useReorderPins();
  const [items, setItems] = useState<Array<PinnedItem>>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // While a grip drag is in flight, ignore pins-query mirrors so a refetch
  // (pin/unpin elsewhere, reorder settle) cannot reset the in-progress order.
  const draggingRef = useRef(false);

  useEffect(() => {
    if (pins && !draggingRef.current) setItems(pins);
  }, [pins]);

  const onDragStart = () => {
    draggingRef.current = true;
  };

  const onReorderCommit = () => {
    draggingRef.current = false;
    const next = itemsRef.current;
    const same =
      next.length === (pins?.length ?? 0) &&
      next.every(
        (pin, i) =>
          pin.itemType === pins?.[i]?.itemType &&
          pin.itemId === pins?.[i]?.itemId,
      );
    if (same) return;
    reorderMutation.mutate(next);
  };

  return { items, setItems, onDragStart, onReorderCommit };
}

/**
 * The rail's mixed chats+projects "Pinned" section (AppShell.dc.html) — one
 * unified list sourced straight from GET /pins (pins is the sole source of
 * pin state, design D5), rendered in owner rank order. Drag-to-reorder is
 * authoring-only here; chat/project sidebars ripple via cache invalidation.
 * Hidden entirely when the caller has no pins — never an empty labelled group.
 */
export function AppSidebarPinned() {
  const { data: pins } = usePins();
  const { items, setItems, onDragStart, onReorderCommit } =
    useReorderablePins(pins);

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
          <Reorder.Group
            as="ul"
            axis="y"
            values={items}
            onReorder={setItems}
            data-slot="sidebar-menu"
            data-sidebar="menu"
            className="flex w-full min-w-0 flex-col gap-1"
          >
            {items.map((pin) => (
              <SortablePinnedRow
                key={pinKey(pin)}
                pin={pin}
                onDragStart={onDragStart}
                onReorderCommit={onReorderCommit}
              />
            ))}
          </Reorder.Group>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
