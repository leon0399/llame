import { useEffect, useReducer, type Dispatch } from "react";

import {
  draftPhaseForSession,
  initialDraftSession,
  reduceDraftSession,
  shouldQueryChatHistory,
  type DraftSessionEvent,
  type DraftSessionState,
} from "@/lib/services/chat/draft-session";
import {
  draftChatPathWithHash,
  type DraftPhase,
} from "@/lib/services/chat/draft-route";
import {
  isChatHistoryMissing,
  useChatMessagesQuery,
} from "@/lib/services/chat/queries";
import { useTargetSendTracking } from "./use-target-send-tracking";

/** Keeps the canonical URL's draft marker in sync with the session state
 *  machine — split out from `useChatSessionState` as its own effect. */
function useDraftUrlSync(chatId: string, session: DraftSessionState) {
  const draftPhase = draftPhaseForSession(session);
  useEffect(() => {
    // An uncertain stream interruption has already moved the URL to the
    // hashless sent-draft route before remounting this ordinary session. Keep
    // that recovery marker until a later successful finish clears it.
    const recoveryDraft =
      draftPhase === null &&
      new URLSearchParams(window.location.search).get("draft") === "sent"
        ? "sent"
        : draftPhase;
    window.history.replaceState(
      window.history.state,
      "",
      draftChatPathWithHash(chatId, recoveryDraft, window.location.hash),
    );
  }, [chatId, draftPhase]);
}

/** Advances the state machine once a "recovering" session's history probe
 *  settles — either the chat is visible (data arrived) or it never existed
 *  / the probe was indeterminate (error). Split out from
 *  `useChatSessionState` as its own pair of effects. */
function useHistoryArrivalEffects(
  session: DraftSessionState,
  dispatch: Dispatch<DraftSessionEvent>,
  historyQuery: ReturnType<typeof useChatMessagesQuery>,
) {
  useEffect(() => {
    if (session.kind !== "recovering" || historyQuery.data === undefined) {
      return;
    }
    dispatch({ type: "chat-visible" });
  }, [historyQuery.data, session.kind, dispatch]);

  useEffect(() => {
    if (session.kind !== "recovering" || !historyQuery.isError) return;
    dispatch({
      type: isChatHistoryMissing(historyQuery.error)
        ? "history-missing"
        : "history-indeterminate",
    });
  }, [historyQuery.error, historyQuery.isError, session.kind, dispatch]);
}

type UseChatSessionStateArgs = {
  chatId: string;
  initialChatExists: boolean;
  initialDraftPhase: DraftPhase | null;
  targetSeq: number | null;
  onTargetSendFinished: () => void;
};

/**
 * Owns the draft/persisted session state machine for one `ChatSession`
 * mount: the reducer, the history probe it gates, target-scoped send
 * tracking, and the two effects that keep the URL and state machine in sync
 * with that probe's outcome. Split out so `ChatSession` composes only the
 * render decision.
 */
export function useChatSessionState({
  chatId,
  initialChatExists,
  initialDraftPhase,
  targetSeq,
  onTargetSendFinished,
}: UseChatSessionStateArgs) {
  const [session, dispatch] = useReducer(
    reduceDraftSession,
    targetSeq === null
      ? initialDraftSession(initialDraftPhase, initialChatExists)
      : { kind: "persisted", resumeRequested: false },
  );
  const historyQuery = useChatMessagesQuery({
    chatId,
    enabled: shouldQueryChatHistory(session),
    recoverSentDraft: session.kind === "recovering",
    targetSeq: targetSeq ?? undefined,
  });
  const { onTargetSendInterrupted, onSendStarted, onSendFailed, onFinished } =
    useTargetSendTracking({
      chatId,
      targetSeq,
      sessionKind: session.kind,
      dispatch,
      onTargetSendFinished,
    });

  useDraftUrlSync(chatId, session);
  useHistoryArrivalEffects(session, dispatch, historyQuery);

  return {
    session,
    historyQuery,
    onTargetSendInterrupted,
    onSendStarted,
    onSendFailed,
    onFinished,
  };
}
