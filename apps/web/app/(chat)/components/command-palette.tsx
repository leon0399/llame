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
  XIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  defaultFilter,
} from "@workspace/ui/components/command";
import { Button } from "@workspace/ui/components/button";
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

// Marks a CommandItem `value` as belonging to the server search-results
// group, so `passThroughServerResultsFilter` below can recognize it. Only
// this component ever constructs a value with this prefix (never derived
// from user input), so the check can't collide with real content.
const SEARCH_RESULT_VALUE_PREFIX = "search-result ";

// cmdk re-scores and re-sorts every item against the raw query using its own
// fuzzy subsequence match over each item's `value`. That's correct for the
// static Actions and the client-only recent-chats list, but wrong for server
// search results: the api already matched (and ordered) them — including
// matches purely in message CONTENT, which isn't part of the item's
// `title`/`snippet` text. cmdk's fuzzy filter scores those exactly 0 (no
// subsequence match at all) and hides them, even though the server found
// them correctly (#171). A constant, non-zero score for every server-result
// item makes cmdk's filter a no-op pass-through for that group — never
// hidden, and never reordered relative to each other (Array.prototype.sort
// is stable, so equal scores preserve the server's original order) — while
// every other item still goes through cmdk's normal fuzzy filter.
function passThroughServerResultsFilter(
  value: string,
  search: string,
  keywords?: string[],
): number {
  if (value.startsWith(SEARCH_RESULT_VALUE_PREFIX)) return 1;
  return defaultFilter(value, search, keywords);
}

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
 *
 * The query is DELIBERATELY not reset when the dialog closes: selecting a
 * search result navigates away and closes the palette, but the query and
 * its results stay put in state, so reopening (⌘K or the sidebar trigger)
 * lands right back on the same result set to try the next one — no
 * retyping. A dedicated clear button in the input is the explicit way out
 * of a stale query.
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
  // `query` has moved on but the 300ms debounce timer hasn't caught up yet —
  // `searchResults` still answers the PREVIOUS debounced term. Now that
  // server-result items bypass cmdk's own filter (see
  // passThroughServerResultsFilter), that filter can no longer be relied on
  // to hide these mid-debounce stale results, so gate the loading state on
  // this explicitly instead.
  const resultsStale = query !== debounced;

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
  // trap / scroll lock behind. The action itself is deferred past the
  // dialog's own close animation (duration-200): running router.push() in
  // the SAME tick as setOpen(false) let the two transitions interleave —
  // Radix's Content stays mounted mid fade-out while the destination route
  // was already rendering underneath, so the palette visibly flickered back
  // in for a moment before settling. Waiting out the animation avoids that
  // without reintroducing the lingering focus-trap/scroll-lock this
  // close-before-navigate ordering was chosen to avoid in the first place.
  const run = (fn: () => void) => {
    setOpen(false);
    setTimeout(fn, 200);
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
        // Server search results are authoritative (already ILIKE-matched and
        // ordered by the api) — pass them through cmdk's filter untouched;
        // everything else (Actions, recent chats) still gets cmdk's normal
        // fuzzy filter. See passThroughServerResultsFilter.
        commandProps={{ filter: passThroughServerResultsFilter }}
      >
        <div className="relative">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search chats, projects, memories…"
            className={query ? "pr-16" : "pr-10"}
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-9 -translate-y-1/2"
              onClick={() => setQuery("")}
            >
              <XIcon />
              <span className="sr-only">Clear search</span>
            </Button>
          )}
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
              {resultsStale || (isSearching && !searchResults?.length) ? (
                // Disabled item keeps cmdk's count non-zero, so "Searching…" and
                // cmdk's own CommandEmpty never render together. Also covers
                // the mid-debounce window (resultsStale): searchResults still
                // answers the PREVIOUS term there, and — since server results
                // now bypass cmdk's filter entirely (see
                // passThroughServerResultsFilter) — showing them unguarded
                // would flash the old term's matches for up to 300ms.
                <CommandItem disabled value={`${query} searching`}>
                  <LoaderCircleIcon className="animate-spin" />
                  Searching…
                </CommandItem>
              ) : (
                searchResults?.map((result) => (
                  <CommandItem
                    key={result.id}
                    // The server already matched and ordered these (title,
                    // snippet, AND message content — cmdk only ever sees
                    // title/snippet). passThroughServerResultsFilter treats
                    // any value carrying this prefix as an unconditional
                    // match, so cmdk neither hides content-only matches nor
                    // re-ranks this group — the id suffix just keeps each
                    // item's value unique for cmdk's own selection tracking.
                    value={`${SEARCH_RESULT_VALUE_PREFIX}${result.title ?? ""} ${result.snippet ?? ""} ${result.id}`}
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
