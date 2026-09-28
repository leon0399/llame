"use client";

import { useState, createContext, useContext } from "react";

export type PermissionMode = "default" | "bypass";

export interface ChatContextType {
  // `undefined` = no model chosen yet (models still loading / none available).
  // The send path requires a concrete `string`, so the compiler forces callers
  // to resolve this absence before sending — no empty-string sentinel.
  selectedModel: string | undefined;
  setSelectedModel: (modelId: string) => void;
  // `undefined` = this model declares no effort vocabulary, or one has not
  // been resolved yet. Sending omits the field entirely in that case and lets
  // the api apply the model's own default.
  selectedEffort: string | undefined;
  setSelectedEffort: (effort: string | undefined) => void;
  getPermissionMode: (chatId: string) => PermissionMode;
  setPermissionMode: (chatId: string, mode: PermissionMode) => void;
}

const ChatContext = createContext<ChatContextType>({
  selectedModel: undefined,
  setSelectedModel: () => {
    throw new Error("setSelectedModel is not implemented");
  },
  selectedEffort: undefined,
  setSelectedEffort: () => {
    throw new Error("setSelectedEffort is not implemented");
  },
  getPermissionMode: () => "default",
  setPermissionMode: () => {
    throw new Error("setPermissionMode is not implemented");
  },
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    undefined,
  );
  const [selectedEffort, setSelectedEffort] = useState<string | undefined>(
    undefined,
  );
  const [permissionModes, setPermissionModes] = useState<
    Record<string, PermissionMode>
  >({});

  const getPermissionMode = (chatId: string): PermissionMode =>
    permissionModes[chatId] ?? "default";
  const setPermissionMode = (chatId: string, mode: PermissionMode): void => {
    setPermissionModes((current) => ({ ...current, [chatId]: mode }));
  };

  return (
    <ChatContext.Provider
      value={{
        selectedModel,
        setSelectedModel,
        selectedEffort,
        setSelectedEffort,
        getPermissionMode,
        setPermissionMode,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export const useChatContext = () => {
  return useContext(ChatContext);
};
