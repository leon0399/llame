"use client";

import {
  useState,
  useCallback,
  useRef,
  createContext,
  useContext,
} from "react";

import type { ChatModelSelectionResponse } from "@/lib/api/generated/models";
import type { PermissionMode } from "@/lib/services/permission-modes/mode";

export type { PermissionMode };

/** What the composer's page has told it about the open Chat. */
type ChatRegistration = {
  chatId: string | null;
  /** The selection the Chat read reports: stored selector, effort, and hold. */
  selection: ChatModelSelectionResponse | null;
  /** False while the page shows a Chat that does not exist yet (a draft). */
  exists: boolean;
  /** A send from this page was accepted, so the Chat is stored now. */
  acceptedSend: boolean;
};

const NO_REGISTRATION: ChatRegistration = {
  chatId: null,
  selection: null,
  exists: true,
  acceptedSend: false,
};

export interface ChatContextType {
  /**
   * The selection the picker shows: the open Chat's stored selection, or the
   * catalog's `defaultSelector` for a Chat that stores none. `null` until the
   * catalog (and, for a stored selection, the Chat read) is available.
   */
  displayedSelection: ChatModelSelectionResponse | null;
  /** False while this page shows a draft: its first send names the selection
   *  the composer shows. */
  chatExists: boolean;
  /** Registers the open Chat's read: its stored selection and whether it
   *  exists yet. Called by the page that owns the Chat read. */
  registerChatSelection: (
    chatId: string,
    selection: ChatModelSelectionResponse | null,
    exists: boolean,
  ) => void;
  /** The selector the owner picked since the last accepted send, if any. */
  pickedSelector: string | undefined;
  /** Picks `selector`; a selector pick replaces the whole selection, so the
   *  picked effort is dropped. */
  pickSelector: (selector: string) => void;
  /** The effort the owner picked since the last accepted send, if any. */
  pickedEffort: string | undefined;
  pickEffort: (effort: string) => void;
  /**
   * A send carrying the picks was accepted: they are no longer picks, and the
   * composer shows `selection` (the selection that send stored), or keeps the
   * stored one when the send stored nothing (`null`).
   */
  acceptSend: (selection: ChatModelSelectionResponse | null) => void;
  getPermissionMode: (chatId: string) => PermissionMode;
  setPermissionMode: (chatId: string, mode: PermissionMode) => void;
}

const ChatContext = createContext<ChatContextType>({
  displayedSelection: null,
  chatExists: true,
  registerChatSelection: () => {
    throw new Error("registerChatSelection is not implemented");
  },
  pickedSelector: undefined,
  pickSelector: () => {
    throw new Error("pickSelector is not implemented");
  },
  pickedEffort: undefined,
  pickEffort: () => {
    throw new Error("pickEffort is not implemented");
  },
  acceptSend: () => {
    throw new Error("acceptSend is not implemented");
  },
  getPermissionMode: () => "default",
  setPermissionMode: () => {
    throw new Error("setPermissionMode is not implemented");
  },
});

/** The owner's unsent picks and the actions that set and spend them. */
function useComposerPicks() {
  const [pickedSelector, setPickedSelector] = useState<string | undefined>(
    undefined,
  );

  const [pickedEffort, setPickedEffort] = useState<string | undefined>(
    undefined,
  );

  const pickSelector = useCallback((selector: string) => {
    setPickedSelector(selector);
    setPickedEffort(undefined);
  }, []);

  const pickEffort = useCallback((effort: string) => {
    setPickedEffort(effort);
  }, []);

  /** Forgets both picks: the send that carried them was accepted. */
  const clearPicks = useCallback(() => {
    setPickedSelector(undefined);
    setPickedEffort(undefined);
  }, []);

  return { pickedSelector, pickedEffort, pickSelector, pickEffort, clearPicks };
}

/** Registers a Chat read on the state: a different Chat starts a new page. */
function registerChat(
  current: ChatRegistration,
  chatId: string,
  selection: ChatModelSelectionResponse | null,
  exists: boolean,
): ChatRegistration {
  if (current.chatId !== chatId) {
    return { chatId, selection, exists, acceptedSend: false };
  }

  return { ...current, selection, exists };
}

/** The open Chat's registration, and the accepted send that spends a draft. */
function useChatRegistration(clearPicks: () => void) {
  const [registration, setRegistration] =
    useState<ChatRegistration>(NO_REGISTRATION);

  // The Chat the picks belong to: a new Chat starts with none of them.
  const registeredId = useRef(registration.chatId);

  const registerChatSelection = useCallback<
    ChatContextType["registerChatSelection"]
  >(
    (chatId, selection, exists) => {
      if (registeredId.current !== chatId) {
        registeredId.current = chatId;
        clearPicks();
      }

      setRegistration((current) =>
        registerChat(current, chatId, selection, exists),
      );
    },
    [clearPicks],
  );

  const acceptSend = useCallback(
    (selection: ChatModelSelectionResponse | null) => {
      clearPicks();
      setRegistration((current) => ({
        ...current,
        acceptedSend: true,
        selection: selection ?? current.selection,
      }));
    },
    [clearPicks],
  );

  return { registration, registerChatSelection, acceptSend };
}

/** The permission mode each Chat's composer chose, defaulting to `default`. */
function usePermissionModes() {
  const [permissionModes, setPermissionModes] = useState<
    Record<string, PermissionMode>
  >({});

  const getPermissionMode = (chatId: string): PermissionMode =>
    permissionModes[chatId] ?? "default";

  const setPermissionMode = (chatId: string, mode: PermissionMode): void => {
    setPermissionModes((current) => ({ ...current, [chatId]: mode }));
  };

  return { getPermissionMode, setPermissionMode };
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const picks = useComposerPicks();

  const { registration, registerChatSelection, acceptSend } =
    useChatRegistration(picks.clearPicks);

  const { getPermissionMode, setPermissionMode } = usePermissionModes();

  const value: ChatContextType = {
    displayedSelection: registration.selection,
    chatExists: registration.exists || registration.acceptedSend,
    registerChatSelection,
    pickedSelector: picks.pickedSelector,
    pickSelector: picks.pickSelector,
    pickedEffort: picks.pickedEffort,
    pickEffort: picks.pickEffort,
    acceptSend,
    getPermissionMode,
    setPermissionMode,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export const useChatContext = () => {
  return useContext(ChatContext);
};
