import { useCallback, useRef, type Dispatch, type RefObject } from "react";

import type {
  DraftSessionEvent,
  DraftSessionState,
} from "@/lib/services/chat/draft-session";
import { draftChatPathWithHash } from "@/lib/services/chat/draft-route";

type TargetSendState =
  | { status: "active"; hash: string }
  | { status: "failed" | "interrupted" | "finished" }
  | null;

/** The target-send state ref plus the one operation both `onFinished` and
 *  `onTargetSendInterrupted` share: consuming an active target send and
 *  rewriting the URL for its outcome. Split out so the main hook composes
 *  only event handlers, not this shared state machine. */
function useTargetSendState(
  chatId: string,
  targetSeq: number | null,
  onTargetSendFinished: () => void,
) {
  const targetSendStateRef = useRef<TargetSendState>(null);

  const consumeTargetSend = useCallback(
    (status: "interrupted" | "finished") => {
      if (
        targetSeq === null ||
        targetSendStateRef.current?.status !== "active"
      ) {
        return false;
      }
      targetSendStateRef.current = { status };
      window.history.replaceState(
        window.history.state,
        "",
        draftChatPathWithHash(
          chatId,
          status === "interrupted" ? "sent" : null,
          "",
        ),
      );
      onTargetSendFinished();
      return true;
    },
    [chatId, onTargetSendFinished, targetSeq],
  );

  return { targetSendStateRef, consumeTargetSend };
}

function useOnSendStarted({
  chatId,
  targetSeq,
  sessionKind,
  dispatch,
  targetSendStateRef,
}: {
  chatId: string;
  targetSeq: number | null;
  sessionKind: DraftSessionState["kind"];
  dispatch: Dispatch<DraftSessionEvent>;
  targetSendStateRef: RefObject<TargetSendState>;
}) {
  return useCallback(() => {
    if (targetSeq !== null) {
      targetSendStateRef.current = {
        status: "active",
        hash: window.location.hash,
      };
      window.history.replaceState(
        window.history.state,
        "",
        draftChatPathWithHash(chatId, "sent", ""),
      );
      if (sessionKind === "fresh") dispatch({ type: "send-started" });
      return;
    }
    if (sessionKind !== "fresh") return;
    window.history.replaceState(
      window.history.state,
      "",
      draftChatPathWithHash(chatId, "sent", window.location.hash),
    );
    dispatch({ type: "send-started" });
  }, [chatId, sessionKind, targetSeq, dispatch, targetSendStateRef]);
}

function useOnSendFailed(
  chatId: string,
  targetSeq: number | null,
  dispatch: Dispatch<DraftSessionEvent>,
  targetSendStateRef: RefObject<TargetSendState>,
) {
  return useCallback(() => {
    const targetSendState = targetSendStateRef.current;
    if (targetSeq !== null) {
      if (targetSendState?.status !== "active") return;
      targetSendStateRef.current = { status: "failed" };
      window.history.replaceState(
        window.history.state,
        "",
        draftChatPathWithHash(chatId, null, targetSendState.hash),
      );
    }
    dispatch({ type: "send-failed" });
  }, [chatId, targetSeq, dispatch, targetSendStateRef]);
}

function useOnFinished(
  chatId: string,
  targetSeq: number | null,
  dispatch: Dispatch<DraftSessionEvent>,
  consumeTargetSend: (status: "interrupted" | "finished") => boolean,
) {
  return useCallback(() => {
    if (targetSeq !== null) {
      if (!consumeTargetSend("finished")) return false;
      dispatch({ type: "finished" });
      return true;
    }
    window.history.replaceState(
      window.history.state,
      "",
      draftChatPathWithHash(chatId, null, window.location.hash),
    );
    dispatch({ type: "finished" });
    return true;
  }, [chatId, consumeTargetSend, targetSeq, dispatch]);
}

/**
 * Tracks a target-scoped send's lifecycle (started/failed/finished/
 * interrupted) against the canonical URL and the draft session state
 * machine. A "target send" is a send performed while `targetSeq` pins the
 * page to one message rather than "latest" — its outcome is reported back
 * via `onTargetSendFinished` instead of driving `dispatch` directly, since
 * the draft state machine only exists for the "latest" (no target) case.
 */
export function useTargetSendTracking(params: {
  chatId: string;
  targetSeq: number | null;
  sessionKind: DraftSessionState["kind"];
  dispatch: Dispatch<DraftSessionEvent>;
  onTargetSendFinished: () => void;
}) {
  const { chatId, targetSeq, sessionKind, dispatch, onTargetSendFinished } =
    params;
  const { targetSendStateRef, consumeTargetSend } = useTargetSendState(
    chatId,
    targetSeq,
    onTargetSendFinished,
  );

  const onTargetSendInterrupted = useCallback(
    () => consumeTargetSend("interrupted"),
    [consumeTargetSend],
  );
  const onSendStarted = useOnSendStarted({
    chatId,
    targetSeq,
    sessionKind,
    dispatch,
    targetSendStateRef,
  });
  const onSendFailed = useOnSendFailed(
    chatId,
    targetSeq,
    dispatch,
    targetSendStateRef,
  );
  const onFinished = useOnFinished(
    chatId,
    targetSeq,
    dispatch,
    consumeTargetSend,
  );

  return { onTargetSendInterrupted, onSendStarted, onSendFailed, onFinished };
}
