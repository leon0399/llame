"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

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

import type { RunPhase } from "@/lib/services/live/live-messages";
import {
  DeleteChatDialog,
  RenameChatDialog,
} from "@/app/(chat)/components/app-sidebar/chat-item-dialogs";
import {
  ChatActivityIndicator,
  resolveChatActivityStatus,
  type ChatActivityStatus,
} from "@/app/(chat)/components/chat-list-sidebar/chat-activity-indicator";
import { ArchivedBadge } from "@/components/archived-badge";
import { SidebarRowTitle } from "@/components/sidebar-row-title";
import { useOptionalActiveRuns } from "@/contexts/active-runs-context";
import { useChatsQuery } from "@/lib/services/chat/queries";
import { useSetChatArchive } from "@/lib/services/chat/management";
import { useReorderPins, useUnpinItem } from "@/lib/services/pins/mutations";
import { usePins } from "@/lib/services/pins/queries";
import type { PinnedItem } from "@/lib/services/pins/types";

import { pinnedChatsFilters } from "@/app/(chat)/components/chat-list-view";

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

function PinnedChatActivity({
  status,
  phase,
}: {
  status: ChatActivityStatus | null;
  phase?: RunPhase;
}) {
  return (
    <>
      <MessagesSquareIcon className="size-4 text-muted-foreground" />
      <ChatActivityIndicator status={status} phase={phase} />
    </>
  );
}

function PinnedChatTitle({
  label,
  archived,
  muted,
  shimmer,
}: {
  label: string;
  archived: boolean;
  muted: boolean;
  shimmer: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <SidebarRowTitle
        text={label}
        animateChanges
        shimmer={shimmer}
        className={cn(muted && "text-muted-foreground")}
      />
      {archived && <ArchivedBadge />}
    </span>
  );
}

function PinnedChatIcon({
  archived,
  status,
  phase,
}: {
  archived: boolean;
  status: ChatActivityStatus | null;
  phase?: RunPhase;
}) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center",
        archived && "opacity-50",
      )}
    >
      <PinnedChatActivity status={status} phase={phase} />
    </span>
  );
}

function PinnedChatLabel({
  pin,
  label,
  isArchived,
  isActive,
  processing,
  status,
  phase,
}: {
  pin: PinnedChat;
  label: string;
  isArchived: boolean;
  isActive: boolean;
  processing: boolean;
  status: ChatActivityStatus | null;
  phase?: RunPhase;
}) {
  const muted = isArchived || (pin.item.title === null && !processing);

  return (
    <SidebarMenuButton
      className="min-w-0 flex-1"
      variant="chromeless"
      render={<Link href={`/chat/${pin.itemId}`} />}
      isActive={isActive}
      tooltip={label}
    >
      <PinnedChatIcon archived={isArchived} status={status} phase={phase} />
      <PinnedChatTitle
        label={label}
        archived={isArchived}
        muted={muted}
        shimmer={pin.item.title === null && processing}
      />
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

type PinnedChatActions = {
  renameOpen: boolean;
  setRenameOpen: (open: boolean) => void;
  deleteOpen: boolean;
  setDeleteOpen: (open: boolean) => void;
  unpin: () => void;
  edit: { label: string; icon: ReactNode; onSelect: () => void };
  toggleArchive: () => void;
  startDelete: () => void;
};

/** The row's mutations and dialog-open state. */
function usePinnedChatActions(
  pin: PinnedChat,
  isArchived: boolean,
): PinnedChatActions {
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

function usePinnedChatActivityState(pin: PinnedChat, runningJobs: number) {
  const activeRuns = useOptionalActiveRuns();
  const live = activeRuns?.activeChatIds.has(pin.itemId) ?? false;

  const awaitingJobs =
    activeRuns?.runStatusByChatId.get(pin.itemId) === "awaiting_jobs";

  const processing = live && !awaitingJobs;

  return {
    processing,
    status: resolveChatActivityStatus({
      processing,
      background: awaitingJobs || (!live && runningJobs > 0),
      outcome: activeRuns?.unseenRunOutcomes.get(pin.itemId),
    }),
    phase: processing
      ? activeRuns?.runPhaseByChatId.get(pin.itemId)
      : undefined,
  };
}

function PinnedChatControls({
  pin,
  dragControls,
  label,
  isActive,
  isArchived,
  actions,
}: {
  pin: PinnedChat;
  dragControls: DragControls;
  label: string;
  isActive: boolean;
  isArchived: boolean;
  actions: PinnedChatActions;
}) {
  return (
    <>
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

type PinnedRowProps<TPin> = {
  pin: TPin;
  dragControls: DragControls;
};

export function PinnedChatRow({
  pin,
  dragControls,
  runningJobs,
}: PinnedRowProps<PinnedChat> & { runningJobs: number }) {
  const pathname = usePathname();
  const activity = usePinnedChatActivityState(pin, runningJobs);
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
        processing={activity.processing}
        status={activity.status}
        phase={activity.phase}
      />
      <PinnedChatControls
        pin={pin}
        dragControls={dragControls}
        label={label}
        isActive={isActive}
        isArchived={isArchived}
        actions={actions}
      />
    </>
  );
}

function SortablePinnedRow({
  pin,
  runningJobsByChatId,
  onDragStart,
  onReorderCommit,
}: {
  pin: PinnedItem;
  runningJobsByChatId: ReadonlyMap<string, number>;
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
          <PinnedChatRow
            pin={pin}
            dragControls={dragControls}
            runningJobs={runningJobsByChatId.get(pin.itemId) ?? 0}
          />
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

function usePinnedChatSummaries(pins: Array<PinnedItem> | undefined) {
  const hasChatPins = pins?.some((pin) => pin.itemType === "chat") ?? false;

  const { data } = useChatsQuery(pinnedChatsFilters(), hasChatPins);

  return useMemo(() => {
    const runningJobsByChatId = new Map<string, number>();

    for (const page of data?.pages ?? []) {
      for (const chat of page) {
        runningJobsByChatId.set(chat.id, chat.runningJobs);
      }
    }

    return runningJobsByChatId;
  }, [data]);
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
  const runningJobsByChatId = usePinnedChatSummaries(pins);

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
                runningJobsByChatId={runningJobsByChatId}
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
