"use client";

import { defaultModelId } from "@/lib/ai/models";
import { useState, createContext, useContext } from "react";

export interface ChatContextType {
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
}

const ChatContext = createContext<ChatContextType>({
  selectedModel: defaultModelId,
  setSelectedModel: () => { throw new Error("setSelectedModel is not implemented"); },
});

export function ChatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedModel, setSelectedModel] = useState<string>(defaultModelId);

  return (
    <ChatContext.Provider value={{ selectedModel, setSelectedModel }}>
      {children}
    </ChatContext.Provider>
  );
}


export const useChatContext = () => {
  return useContext(ChatContext);
};
