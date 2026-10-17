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

/** Which items a list shows — the same three on every chat and project list. */
export type ListShow = "active" | "archived" | "all";

const SHOW_LABELS = new Map<ListShow, string>([
  ["active", "Active"],
  ["archived", "Archived"],
  ["all", "All"],
]);

function isChatListShow(value: unknown): value is ListShow {
  return value === "active" || value === "archived" || value === "all";
}

/** The `?archived` filter a view sends; Active is the server default. */
export function archivedFilter(show: ListShow): "only" | "with" | undefined {
  if (show === "archived") return "only";
  if (show === "all") return "with";
  return undefined;
}

/** The view's list on any chat list surface (the rail, a project page).
 *  Active and All sit below a Pinned section, so they exclude pins; Archived
 *  has no Pinned section and lists archived pins too. */
export function chatListFilters(
  show: ListShow,
  projectId?: string,
): ChatListFilters {
  if (show === "archived") return { projectId, archived: "only" };
  return { projectId, pinned: "exclude", archived: archivedFilter(show) };
}

/** The Pinned section above Active and All, archived pins included. */
export function pinnedChatsFilters(projectId?: string): ChatListFilters {
  return { projectId, pinned: "only", archived: "with" };
}

type ShowControlProps = {
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
            {[...SHOW_LABELS].map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
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
  const label = SHOW_LABELS.get(show);
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
