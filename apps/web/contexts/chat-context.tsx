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

export type ComposerPicks = {
  selector: string | undefined;
  effort: string | undefined;
  selectorRevision: number;
  effortRevision: number;
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
  picks: ComposerPicks;
  /**
   * A send carrying the picks was accepted: they are no longer picks, and the
   * composer shows `selection` (the selection that send stored), or keeps the
   * stored one when the send stored nothing (`null`).
   */
  acceptSend: (
    selection: ChatModelSelectionResponse | null,
    picks: ComposerPicks,
  ) => void;
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
  picks: {
    selector: undefined,
    effort: undefined,
    selectorRevision: 0,
    effortRevision: 0,
  },
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

/** Remove only picks whose generation still matches the prepared request. */
function retireSelectionPicks(
  current: ComposerPicks,
  carried: ComposerPicks,
): ComposerPicks {
  const retireSelector = current.selectorRevision === carried.selectorRevision;
  const retireEffort = current.effortRevision === carried.effortRevision;

  return {
    selector: retireSelector ? undefined : current.selector,
    effort: retireEffort ? undefined : current.effort,
    selectorRevision: current.selectorRevision + Number(retireSelector),
    effortRevision: current.effortRevision + Number(retireEffort),
  };
}

const EMPTY_COMPOSER_PICKS: ComposerPicks = {
  selector: undefined,
  effort: undefined,
  selectorRevision: 0,
  effortRevision: 0,
};

/** The owner's unsent picks and the actions that set and spend them. */
function useComposerPicks() {
  const [picks, setPicks] = useState<ComposerPicks>(EMPTY_COMPOSER_PICKS);

  const pickSelector = useCallback((selector: string) => {
    setPicks((current) => ({
      selector,
      effort: undefined,
      selectorRevision: current.selectorRevision + 1,
      effortRevision: current.effortRevision + 1,
    }));
  }, []);

  const pickEffort = useCallback((effort: string) => {
    setPicks((current) => ({
      ...current,
      effort,
      effortRevision: current.effortRevision + 1,
    }));
  }, []);

  const clearPicks = useCallback(() => {
    setPicks((current) => ({
      selector: undefined,
      effort: undefined,
      selectorRevision: current.selectorRevision + 1,
      effortRevision: current.effortRevision + 1,
    }));
  }, []);

  const retirePicks = useCallback((carried: ComposerPicks) => {
    setPicks((current) => retireSelectionPicks(current, carried));
  }, []);

  return {
    pickedSelector: picks.selector,
    pickedEffort: picks.effort,
    picks,
    pickSelector,
    pickEffort,
    clearPicks,
    retirePicks,
  };
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
function useChatRegistration(
  clearPicks: () => void,
  retirePicks: (picks: ComposerPicks) => void,
) {
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
    (selection: ChatModelSelectionResponse | null, picks: ComposerPicks) => {
      retirePicks(picks);
      setRegistration((current) => ({
        ...current,
        acceptedSend: true,
        selection: selection ?? current.selection,
      }));
    },
    [retirePicks],
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
    useChatRegistration(picks.clearPicks, picks.retirePicks);

  const { getPermissionMode, setPermissionMode } = usePermissionModes();

  const value: ChatContextType = {
    displayedSelection: registration.selection,
    chatExists: registration.exists || registration.acceptedSend,
    registerChatSelection,
    pickedSelector: picks.pickedSelector,
    pickSelector: picks.pickSelector,
    pickedEffort: picks.pickedEffort,
    picks: picks.picks,
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
