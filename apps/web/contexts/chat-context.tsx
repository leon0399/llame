"use client";

import { safeRandomUUID } from "@/lib/uuid";
import {
  useCallback,
  useEffect,
  useState,
  createContext,
  useContext,
} from "react";

export interface ChatContextType {
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  activeChatId: string | null;
  setActiveChatId: (chatId: string | null) => void;
  draftChatId: string | null;
  setDraftChatId: (chatId: string | null) => void;
  recordSentDraft: (chatId: string) => void;
  draftRestored: boolean;
}

const ChatContext = createContext<ChatContextType>({
  selectedModel: "",
  setSelectedModel: () => {
    throw new Error("setSelectedModel is not implemented");
  },
  activeChatId: null,
  setActiveChatId: () => {
    throw new Error("setActiveChatId is not implemented");
  },
  draftChatId: null,
  draftRestored: false,
  recordSentDraft: () => {
    throw new Error("recordSentDraft is not implemented");
  },
  setDraftChatId: () => {
    throw new Error("setDraftChatId is not implemented");
  },
});

const DRAFT_CHAT_STORAGE_KEY = "llame:draft-chat-id";

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  // Backed by sessionStorage (per-tab) so a SENT draft chat's id survives a
  // refresh: a first answer streaming on `/` stays resumable (#49) instead of
  // being stranded until the user finds the chat in the sidebar.
  //
  // The restore happens in a mount EFFECT, not a useState initializer: an
  // initializer would render a different tree on the client than the server
  // rendered (Persisted vs Draft session) — a hydration mismatch. The effect
  // path hydrates cleanly, then swaps to the restored draft. draftRestored
  // marks that the id came from storage (i.e. a send preceded a refresh) —
  // an in-app New Chat mint must NOT count as restorable, or fresh drafts
  // would mount through the persisted-chat path.
  const [draftChatId, setDraftChatIdState] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    const stored = window.sessionStorage.getItem(DRAFT_CHAT_STORAGE_KEY);
    if (stored !== null) {
      setDraftChatIdState(stored);
      setDraftRestored(true);
    }
  }, []);
  // State-only: an in-app draft mint (New Chat) must NOT persist — only a
  // SEND makes a draft worth restoring after a refresh (recordSentDraft).
  // Clearing (null) always clears storage too, so a stale id can't linger.
  const setDraftChatId = useCallback((chatId: string | null) => {
    setDraftChatIdState(chatId);
    setDraftRestored(false);
    if (chatId === null) {
      window.sessionStorage.removeItem(DRAFT_CHAT_STORAGE_KEY);
    }
  }, []);
  const recordSentDraft = useCallback((chatId: string) => {
    setDraftChatIdState(chatId);
    setDraftRestored(false);
    window.sessionStorage.setItem(DRAFT_CHAT_STORAGE_KEY, chatId);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        selectedModel,
        setSelectedModel,
        activeChatId,
        setActiveChatId,
        draftChatId,
        setDraftChatId,
        recordSentDraft,
        draftRestored,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export const useChatContext = () => {
  return useContext(ChatContext);
};

// Canonical "start a new chat" transition — every New-chat affordance goes
// through this so the semantics can't drift between call sites.
export function useStartNewChat() {
  const { setActiveChatId, setDraftChatId } = useChatContext();

  return useCallback(() => {
    setActiveChatId(null);
    setDraftChatId(safeRandomUUID());
  }, [setActiveChatId, setDraftChatId]);
}
