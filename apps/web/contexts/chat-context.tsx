"use client";

import { DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { useState, createContext, useContext } from "react";

export interface ChatContextType {
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  activeChatId: string | null;
  setActiveChatId: (chatId: string | null) => void;
}

const ChatContext = createContext<ChatContextType>({
  selectedModel: DEFAULT_MODEL_ID,
  setSelectedModel: () => { throw new Error("setSelectedModel is not implemented"); },
  activeChatId: null,
  setActiveChatId: () => { throw new Error("setActiveChatId is not implemented"); },
});

export function ChatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  return (
    <ChatContext.Provider value={{ selectedModel, setSelectedModel, activeChatId, setActiveChatId }}>
      {children}
    </ChatContext.Provider>
  );
}


export const useChatContext = () => {
  return useContext(ChatContext);
};
