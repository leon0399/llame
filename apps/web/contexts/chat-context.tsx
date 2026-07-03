"use client";

import { DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { safeRandomUUID } from "@/lib/uuid";
import { useCallback, useState, createContext, useContext } from "react";

export interface ChatContextType {
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  activeChatId: string | null;
  setActiveChatId: (chatId: string | null) => void;
  draftChatId: string | null;
  setDraftChatId: (chatId: string | null) => void;
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
  setDraftChatId: () => {
    throw new Error("setDraftChatId is not implemented");
  },
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [draftChatId, setDraftChatId] = useState<string | null>(null);

  return (
    <ChatContext.Provider
      value={{
        selectedModel,
        setSelectedModel,
        activeChatId,
        setActiveChatId,
        draftChatId,
        setDraftChatId,
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
