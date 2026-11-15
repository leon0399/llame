"use client";

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { useChatsQuery, type ChatResponse } from "@/lib/services/chat/queries";
import {
  MIN_SEARCH_LENGTH,
  useChatSearchQuery,
  type ChatSearchResult,
} from "@/lib/services/chat/search";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { isPaletteToggle } from "@/lib/command-palette";

// The dialog (cmdk and its Radix dialog) loads the first time the palette
// opens, keeping it out of every chat page's first-load bundle.
const CommandPaletteDialog = lazy(() =>
  import("./command-palette-dialog").then((module) => ({
    default: module.CommandPaletteDialog,
  })),
);

/** What the palette dialog renders from; owned by the provider so the query
 *  survives the dialog closing. */
export interface CommandPaletteState {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  chats: Array<ChatResponse>;
  query: string;
  setQuery: (query: string) => void;
  searchResults: Array<ChatSearchResult> | undefined;
  isSearching: boolean;
  searching: boolean;
  resultsStale: boolean;
  openPalette: () => void;
  run: (fn: () => void) => void;
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

/** The ⌘K listener that toggles the palette — split out from
 *  `useCommandPaletteState` since it's a self-contained effect with no other
 *  dependency on that hook's state. */
function usePaletteToggleShortcut(
  setOpen: React.Dispatch<React.SetStateAction<boolean>>,
) {
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
  }, [setOpen]);
}

/**
 * The palette's state: open/close, the ⌘K listener, the search query and its
 * debounced/results derivations, and the close-then-act navigation helper.
 * Split out so `CommandPaletteProvider` composes only markup.
 */
function useCommandPaletteState(): CommandPaletteState {
  const [open, setOpen] = useState(false);
  const { data: chatsData } = useChatsQuery();
  const chats = chatsData?.pages.flat() ?? [];

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

  usePaletteToggleShortcut(setOpen);

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
  const run = useCallback((fn: () => void) => {
    setOpen(false);
    setTimeout(fn, 200);
  }, []);

  return {
    open,
    setOpen,
    chats,
    query,
    setQuery,
    searchResults,
    isSearching,
    searching,
    resultsStale,
    openPalette,
    run,
  };
}

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = useCommandPaletteState();
  // Mounted from the first open on, so later closes still animate out.
  const [opened, setOpened] = useState(false);
  if (state.open && !opened) setOpened(true);

  return (
    <CommandPaletteContext.Provider value={{ open: state.openPalette }}>
      {children}
      {opened ? (
        <Suspense fallback={null}>
          <CommandPaletteDialog {...state} />
        </Suspense>
      ) : null}
    </CommandPaletteContext.Provider>
  );
}
