"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { useRouter } from "next/navigation";
import {
  LoaderCircleIcon,
  MessageSquareTextIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@workspace/ui/components/command";
import { Kbd } from "@workspace/ui/components/kbd";

import { useChatsQuery } from "@/lib/services/chat/queries";
import {
  MIN_SEARCH_LENGTH,
  useChatSearchQuery,
} from "@/lib/services/chat/search";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useChatContext } from "@/contexts/chat-context";
import { isPaletteToggle } from "@/lib/command-palette";
import { safeRandomUUID } from "@/lib/uuid";

// Placeholder for untitled chats (title === null, generation pending or a
// content-only match) — matches the label used by the chat list itself.
const UNTITLED_CHAT_LABEL = "New chat";

const CommandPaletteContext = createContext<{ open: () => void } | null>(null);

/** Opens the command palette (for a trigger button anywhere in the chat app). */
export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error(
      "useCommandPalette must be used within CommandPaletteProvider",
    );
  }
  return ctx;
}

/**
 * Global Cmd/Ctrl+K command palette: quick actions and jump-to-chat
 * (searching both title AND message content once >= 2 chars are typed).
 * Mounted once in the chat layout. cmdk's `CommandDialog` here is a plain
 * Dialog wrapper — it does NOT bind its own Cmd+K, so this single listener
 * is the only one.
 *
 * This IS the sidebar's "Search" surface (its trigger just calls `open()`,
 * same as ⌘K) — the design's dedicated "Search" overlay (a top-anchored
 * modal listing grouped chats/projects/memories) turned out to describe this
 * dialog's active-search state, not a separate popover. Actions stay mounted
 * at all times (so "settings"/"new chat" are still searchable via cmdk's own
 * fuzzy filter) — crossing MIN_SEARCH_LENGTH only swaps the recent-chats list
 * (cmdk's client-side title filter) for the server content-search "Chats"
 * group; projects/memories don't exist yet, so only "Chats" ever renders
 * there. Model switching (previously a "Switch model" group here) has its
 * own dedicated UI (`model-selector.tsx`) and was dropped from this surface
 * — with 13 static models it also pushed "Chats" below the dialog's visible
 * scroll area, hiding recent chats at rest. Both the recent-chats list and
 * the content-search results render the same `lastMessage`/`snippet`
 * excerpt line under the title (matching the sidebar chat list's own
 * excerpt) — the two "Chats" states are the same row shape either way.
 */
export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data: chatsData } = useChatsQuery();
  const chats = chatsData?.pages.flat() ?? [];
  const { setActiveChatId, setDraftChatId } = useChatContext();

  // Controlled input drives both the debounced content search and the server-
  // result item values. Hooks run every render (Rules of Hooks); the query self-
  // gates the fetch (enabled >= MIN). The mode flag uses the DEBOUNCED value so
  // crossing MIN doesn't flash an empty "search" state for the debounce window.
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const { data: searchResults, isFetching: isSearching } =
    useChatSearchQuery(debounced);
  const searching = debounced.trim().length >= MIN_SEARCH_LENGTH;

  // Reset the query whenever the palette closes (any path), so it reopens fresh.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const isMac = /Mac|iPod|iPhone|iPad/.test(
      navigator.platform || navigator.userAgent || "",
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // a held chord must not flicker open/close
      if (isPaletteToggle(e, isMac)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Mint a fresh draft chat (matching the sidebar's New Chat control) — a bare
  // push('/') would no-op or resume a stale draft from ChatProvider state.
  const newChat = () => {
    setActiveChatId(null);
    setDraftChatId(safeRandomUUID());
    router.push("/");
  };

  const openPalette = useCallback(() => setOpen(true), []);
  // Close FIRST, then act — so navigation doesn't leave the dialog's focus
  // trap / scroll lock behind.
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandPaletteContext.Provider value={{ open: openPalette }}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command palette"
        // Design's Search overlay is top-anchored (~14vh), not centered, and
        // sits on the --popover surface (DESIGN.md §8 overlay convention) at
        // a wider 36rem (max-w-xl) than the shadcn dialog default. No X close
        // button — the design shows only the Esc hint, and the two would
        // overlap in the same top-right corner.
        className="top-[14vh] translate-y-0 bg-popover text-popover-foreground sm:max-w-xl"
        showCloseButton={false}
      >
        <div className="relative">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search chats, projects, memories…"
            className="pr-10"
          />
          <Kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
            Esc
          </Kbd>
        </div>
        <CommandList>
          <CommandEmpty>No matches. Try another term.</CommandEmpty>

          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => run(newChat)}>
              <SquarePenIcon />
              New chat
            </CommandItem>
            <CommandItem onSelect={() => run(() => router.push("/settings"))}>
              <SettingsIcon />
              Settings
            </CommandItem>
          </CommandGroup>

          {searching ? (
            <CommandGroup heading="Chats">
              {isSearching && !searchResults?.length ? (
                // Disabled item keeps cmdk's count non-zero, so "Searching…" and
                // cmdk's own CommandEmpty never render together.
                <CommandItem disabled value={`${query} searching`}>
                  <LoaderCircleIcon className="animate-spin" />
                  Searching…
                </CommandItem>
              ) : (
                searchResults?.map((result) => (
                  <CommandItem
                    key={result.id}
                    // Stable searchable text (title/snippet), NOT the live
                    // `query` state: embedding the live query kept a stale
                    // result matching for the whole debounce window even
                    // after the user typed something unrelated (the value
                    // always "contained" whatever was just typed). Title/
                    // snippet are guaranteed to contain the DEBOUNCED term
                    // the server already matched against, so cmdk's own
                    // client-side filter naturally hides stale items the
                    // instant a genuinely different query is typed.
                    value={`search-result ${result.title ?? ""} ${result.snippet ?? ""} ${result.id}`}
                    onSelect={() =>
                      run(() => router.push(`/chat/${result.id}`))
                    }
                  >
                    <MessageSquareTextIcon />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {result.title ?? UNTITLED_CHAT_LABEL}
                      </span>
                      {result.snippet && (
                        <span className="truncate text-xs text-muted-foreground">
                          {result.snippet}
                        </span>
                      )}
                    </div>
                    <CommandShortcut>Chat</CommandShortcut>
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          ) : (
            chats.length > 0 && (
              <CommandGroup heading="Chats">
                {chats.map((chat) => (
                  <CommandItem
                    key={chat.id}
                    value={`chat ${chat.title ?? UNTITLED_CHAT_LABEL} ${chat.id}`}
                    onSelect={() => run(() => router.push(`/chat/${chat.id}`))}
                  >
                    <MessageSquareTextIcon />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {chat.title ?? UNTITLED_CHAT_LABEL}
                      </span>
                      {chat.lastMessage && (
                        <span className="truncate text-xs text-muted-foreground">
                          {chat.lastMessage}
                        </span>
                      )}
                    </div>
                    <CommandShortcut>Chat</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          )}
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
