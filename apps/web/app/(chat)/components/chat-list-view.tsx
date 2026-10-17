"use client";

import * as React from "react";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { ListFilterIcon, XIcon } from "lucide-react";

import type { ChatListFilters } from "@/lib/services/chat/queries";
import type { ProjectListFilters } from "@/lib/services/project/queries";

const LIST_SHOWS = ["active", "archived", "all"] as const;

/** Which items a list shows — the same three on every chat and project list. */
export type ListShow = (typeof LIST_SHOWS)[number];

const SHOW_LABELS: Record<ListShow, string> = {
  active: "Active",
  archived: "Archived",
  all: "All",
};

function isChatListShow(value: unknown): value is ListShow {
  return LIST_SHOWS.some((show) => show === value);
}

/** The `?archived` filter a view sends; Active is the server default. */
export function archivedFilter(show: ListShow): "only" | "with" | undefined {
  if (show === "archived") return "only";
  if (show === "all") return "with";
  return undefined;
}

/** The view's list on any chat or project list surface (the rails, a project
 *  page). Active and All sit below a Pinned section, so they exclude pins;
 *  Archived has no Pinned section and lists archived pins too. */
export function listViewFilters(show: ListShow): ProjectListFilters {
  if (show === "archived") return { archived: "only" };
  return { pinned: "exclude", archived: archivedFilter(show) };
}

/** The Pinned section above Active and All, archived pins included. */
export const PINNED_LIST_FILTERS = {
  pinned: "only",
  archived: "with",
} as const;

export function chatListFilters(
  show: ListShow,
  projectId?: string,
): ChatListFilters {
  return { projectId, ...listViewFilters(show) };
}

export function pinnedChatsFilters(projectId?: string): ChatListFilters {
  return { projectId, ...PINNED_LIST_FILTERS };
}

/**
 * The open item is always listed, whatever the view: archiving it, or opening
 * an archived one from search or a link, never makes the row vanish or the
 * view switch. It slots into `updatedAt` order and leaves on navigation.
 */
export function withOpenItem<T extends { id: string; updatedAt: string }>(
  items: Array<T>,
  open: T | undefined,
  shownElsewhere: ReadonlyArray<T>,
): Array<T> {
  if (!open) return items;
  const listed = (item: T) => item.id === open.id;
  if (items.some(listed) || shownElsewhere.some(listed)) return items;
  return [...items, open].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export type ShowControlProps = {
  show: ListShow;
  onShowChange: (show: ListShow) => void;
};

/** The menu trigger turns secondary while a non-default view is applied, so
 *  a forgotten filter stays visible. */
function ListViewTrigger({ show }: { show: ListShow }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={
              <Button
                variant={show === "active" ? "ghost" : "secondary"}
                size="icon"
                className="size-8"
              />
            }
          />
        }
      >
        <ListFilterIcon />
        <span className="sr-only">View options</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        View options
      </TooltipContent>
    </Tooltip>
  );
}

/** The list's view menu: a Show radio today, room for more filters later. */
export function ListViewMenu({ show, onShowChange }: ShowControlProps) {
  return (
    <DropdownMenu>
      <ListViewTrigger show={show} />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={show}
            onValueChange={(value) => {
              if (isChatListShow(value)) onShowChange(value);
            }}
          >
            {LIST_SHOWS.map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {SHOW_LABELS[value]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The applied non-default view, removable in one click. */
export function ListViewChip({ show, onShowChange }: ShowControlProps) {
  if (show === "active") return null;
  const label = SHOW_LABELS[show];
  return (
    <div className="px-2 pt-1">
      <Button
        variant="secondary"
        size="xs"
        onClick={() => onShowChange("active")}
        aria-label={`Clear view: ${label}`}
      >
        {label}
        <XIcon />
      </Button>
    </div>
  );
}

const ChatListShowContext = React.createContext<ShowControlProps | null>(null);

/** One view state for the chats rail and the mobile sheet, which render the
 *  same list in two places. In memory only: a reload returns to Active. */
export function ChatListShowProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [show, setShow] = React.useState<ListShow>("active");
  const value = React.useMemo(() => ({ show, onShowChange: setShow }), [show]);
  return (
    <ChatListShowContext.Provider value={value}>
      {children}
    </ChatListShowContext.Provider>
  );
}

export function useChatListShow(): ShowControlProps {
  const value = React.useContext(ChatListShowContext);
  if (value === null) {
    throw new Error("useChatListShow requires ChatListShowProvider");
  }
  return value;
}
