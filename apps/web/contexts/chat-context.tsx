"use client";

import { DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { useMe } from "@/lib/services/auth/queries";
import {
  readSelectedModel,
  writeSelectedModel,
} from "@/lib/services/models/selected-model-storage";
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
  selectedModel: DEFAULT_MODEL_ID,
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
  // Start with the default (SSR + first client render match — no hydration
  // mismatch), then restore the persisted choice post-mount.
  const [selectedModel, setSelectedModelState] =
    useState<string>(DEFAULT_MODEL_ID);
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

  // Keyed PER USER: llame is multi-user (incl. a family on one browser), so a
  // shared machine must not bleed one user's model choice to another. userId is
  // async (like the send-guard's availableModels) — the restore lands once it
  // resolves, well before any user send (no auto-submit-on-mount path).
  const userId = useMe().data?.id;

  useEffect(() => {
    if (!userId) return;
    const stored = readSelectedModel(userId);
    if (stored) setSelectedModelState(stored);
  }, [userId]);

  // Persist the choice so it survives a reload (a stale id no longer available
  // is handled by the send-side model guard, not here).
  const setSelectedModel = useCallback(
    (modelId: string) => {
      setSelectedModelState(modelId);
      if (userId) writeSelectedModel(userId, modelId);
    },
    [userId],
  );

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
