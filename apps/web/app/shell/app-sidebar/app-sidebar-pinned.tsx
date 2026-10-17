"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarSeparator,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { Reorder, useDragControls, type DragControls } from "framer-motion";
import { MessagesSquareIcon, PenLineIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  DeleteChatDialog,
  RenameChatDialog,
} from "@/app/(chat)/components/app-sidebar/chat-item-dialogs";
import { useReorderPins, useUnpinItem } from "@/lib/services/pins/mutations";
import { useSetChatArchive } from "@/lib/services/chat/management";
import type { PinnedItem } from "@/lib/services/pins/types";
import { usePins } from "@/lib/services/pins/queries";
import { useOptionalActiveRuns } from "@/contexts/active-runs-context";
import { ArchivedBadge } from "@/components/archived-badge";
import { SidebarRowTitle } from "@/components/sidebar-row-title";

import { PinnedProjectRow } from "./pinned-project-row";
import { PinDragHandle, PinRowMenu, PinRowSurface } from "./pinned-row-parts";

// Placeholder for an untitled pinned chat (title === null, generation
// pending). Same literal as chat-item.tsx/command-palette.tsx's
// UNTITLED_CHAT_LABEL — kept local per this repo's convention of a
// per-render-site constant rather than a shared import.
const UNTITLED_CHAT_LABEL = "New chat";

type PinnedChat = Extract<PinnedItem, { itemType: "chat" }>;

function pinKey(pin: PinnedItem): string {
  return `${pin.itemType}-${pin.itemId}`;
}

function PinnedChatLabel({
  pin,
  label,
  isArchived,
  isActive,
}: {
  pin: PinnedChat;
  label: string;
  isArchived: boolean;
  isActive: boolean;
}) {
  // Optional: the admin shell mounts this rail without the runs provider, and
  // there "nothing is running here" is the honest answer rather than a crash.
  const activeRuns = useOptionalActiveRuns();
  const naming = activeRuns?.activeChatIds.has(pin.itemId) ?? false;
  const muted = isArchived || (pin.item.title === null && !naming);
  return (
    <SidebarMenuButton
      className="min-w-0 flex-1"
      variant="chromeless"
      render={<Link href={`/chat/${pin.itemId}`} />}
      isActive={isActive}
      tooltip={label}
    >
      {/* Archived rows read as de-emphasized (mock's
          `.pin-item[data-archived]` icon opacity + muted title). */}
      <MessagesSquareIcon className={cn(isArchived && "opacity-50")} />
      {/* Wrapper so the row's `[&>span:last-child]:truncate` rule lands here
          and not on the title, which fades rather than ellipses. */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <SidebarRowTitle
          text={label}
          animateChanges
          // Same rules as the list row: shimmer while named, muted once idle.
          shimmer={pin.item.title === null && naming}
          className={cn(muted && "text-muted-foreground")}
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
    edit: {
      label: "Rename",
      icon: <PenLineIcon />,
      onSelect: () => setTimeout(() => setRenameOpen(true), 0),
    },
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
  const actions = usePinnedChatActions(pin, isArchived);

  return (
    <>
      <PinnedChatLabel
        pin={pin}
        label={label}
        isArchived={isArchived}
        isActive={isActive}
      />
      <PinDragHandle dragControls={dragControls} />
      <PinRowMenu
        isActive={isActive}
        onUnpin={actions.unpin}
        edit={actions.edit}
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
      className="relative"
    >
      {pin.itemType === "chat" ? (
        <PinRowSurface>
          <PinnedChatRow pin={pin} dragControls={dragControls} />
        </PinRowSurface>
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
  // The commit handler below reads this after a drag gesture, i.e. after a
  // commit — never during render — so the mirror is written in a layout
  // effect rather than while rendering.
  useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);
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
