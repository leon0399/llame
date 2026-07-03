"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { useRouter } from "next/navigation";
import { CheckIcon, SettingsIcon, SquarePenIcon } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";

import { useChatsQuery } from "@/lib/services/chat/queries";
import { useModelsQuery } from "@/lib/services/models/queries";
import { useChatContext } from "@/contexts/chat-context";
import { isPaletteToggle } from "@/lib/command-palette";
import { safeRandomUUID } from "@/lib/uuid";

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
 * Global Cmd/Ctrl+K command palette: quick actions, fast model switching, and
 * jump-to-chat. Mounted once in the chat layout (inside ChatProvider so it can
 * set the selected model). cmdk's `CommandDialog` here is a plain Dialog wrapper
 * — it does NOT bind its own Cmd+K, so this single listener is the only one.
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
  const { data: models = [] } = useModelsQuery();
  const { selectedModel, setSelectedModel, setActiveChatId, setDraftChatId } =
    useChatContext();

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
      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette">
        <CommandInput placeholder="Search chats, switch model, or run an action…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>

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

          {models.length > 0 && (
            <CommandGroup heading="Switch model">
              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  value={`model ${model.name} ${model.id}`}
                  onSelect={() => run(() => setSelectedModel(model.id))}
                >
                  {model.id === selectedModel ? (
                    <CheckIcon />
                  ) : (
                    <span className="size-4" />
                  )}
                  {model.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {chats.length > 0 && (
            <CommandGroup heading="Chats">
              {chats.map((chat) => (
                <CommandItem
                  key={chat.id}
                  value={`chat ${chat.title} ${chat.id}`}
                  onSelect={() => run(() => router.push(`/chat/${chat.id}`))}
                >
                  {chat.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
