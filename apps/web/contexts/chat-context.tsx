"use client";

import { useState, createContext, useContext } from "react";

export interface ChatContextType {
  // `undefined` = no model chosen yet (models still loading / none available).
  // The send path requires a concrete `string`, so the compiler forces callers
  // to resolve this absence before sending — no empty-string sentinel.
  selectedModel: string | undefined;
  setSelectedModel: (modelId: string) => void;
}

const ChatContext = createContext<ChatContextType>({
  selectedModel: undefined,
  setSelectedModel: () => {
    throw new Error("setSelectedModel is not implemented");
  },
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    undefined,
  );

  return (
    <ChatContext.Provider
      value={{
        selectedModel,
        setSelectedModel,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export const useChatContext = () => {
  return useContext(ChatContext);
};
