import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import type { QueryClient } from "@tanstack/react-query";

import { useLatestRef } from "@/lib/hooks/use-latest-ref";
import { authAwareFetch } from "@/lib/api/fetch";
import {
  buildChatMessagesUrl,
  NO_MODEL_SELECTED_ERROR,
  prepareReconnectToStreamRequest,
  prepareSendMessagesRequest,
} from "@/lib/services/chat/transport";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import { pinQueryKeys } from "@/lib/services/pins/queries";
import { hasModelId, useModelsQuery } from "@/lib/services/models/queries";
import { adoptServerHistory } from "@/lib/services/chat/history";
import {
  notificationLabel,
  streamingRunId,
} from "@/lib/services/chat/run-notifications";
import { safeRandomUUID } from "@/lib/uuid";

/**
 * The lower-level `useChat` plumbing `useChatConversation` composes: model
 * readiness, the send transport, cache refresh, the `useChat` call itself,
 * and its adjacent effects (scroll-to-target, resume/history-adoption,
 * run-presence). Split into its own module once `use-chat-conversation.ts`
 * outgrew the project's 500-line cap.
 */

/** The available models and this chat's ability to send right now — derived
 *  from the models query and kept in sync with `selectedModel` by one
 *  reconciliation effect. */
export function useChatModelSelection(
  selectedModel: string | undefined,
  setSelectedModel: (modelId: string) => void,
) {
  const modelsQuery = useModelsQuery();
  const availableModels = modelsQuery.data?.models ?? [];
  const selectedModelAvailable = hasModelId(availableModels, selectedModel);

  useEffect(() => {
    if (!modelsQuery.data || modelsQuery.data.models.length === 0) return;
    if (!hasModelId(modelsQuery.data.models, selectedModel)) {
      setSelectedModel(modelsQuery.data.defaultModelId);
    }
  }, [modelsQuery.data, selectedModel, setSelectedModel]);

  const modelSendUnavailableReason = (() => {
    if (modelsQuery.isPending) return null;
    if (modelsQuery.isError) {
      return "Models could not be loaded; chat sending is unavailable.";
    }
    if (availableModels.length === 0) {
      return "No chat models are configured; chat sending is unavailable.";
    }
    if (!selectedModelAvailable) {
      return "Select an available model to send.";
    }
    return null;
  })();
  const modelReadyForSend = modelsQuery.isSuccess && selectedModelAvailable;

  return { availableModels, modelSendUnavailableReason, modelReadyForSend };
}

/** The `DefaultChatTransport` instance, id-stable per `chatId`. */
export function useChatSendTransport(
  chatId: string,
  selectedModel: string | undefined,
  selectedEffort: string | undefined,
) {
  // useChat (@ai-sdk/react) creates its Chat once per chatId and NEVER adopts a
  // new `transport` instance afterwards (it only recreates on an id change).
  // Closing the transport over `selectedModel` therefore froze it at the
  // first-render value (undefined, before models load), so a model chosen after
  // load never reached the request — the send failed with "no selected model".
  // Read the model from a ref instead, so the id-stable transport always sends
  // the CURRENT selection. Assigned during render (not via an effect) — it's a
  // plain latest-value mirror, only read later inside prepareSendMessagesRequest.
  const selectedModelRef = useLatestRef(selectedModel);
  // Same frozen-closure hazard as the model above: the transport is created
  // once, so reading `selectedEffort` directly would pin the first turn's
  // level for the life of the chat. `useLatestRef` bundles the per-render
  // assignment with the ref's creation — writing the two separately is how
  // effort came to be silently omitted from every send.
  const selectedEffortRef = useLatestRef(selectedEffort);

  return useMemo(
    () =>
      new DefaultChatTransport({
        api: buildChatMessagesUrl(chatId),
        credentials: "include",
        fetch: authAwareFetch,
        prepareSendMessagesRequest: (options) => {
          const modelId = selectedModelRef.current;
          const effort = selectedEffortRef.current;
          if (modelId === undefined) {
            // Unreachable in practice (both send affordances are gated on
            // modelReadyForSend), but this narrows undefined → string so a
            // request can never be built without a model.
            throw new Error(NO_MODEL_SELECTED_ERROR);
          }
          return prepareSendMessagesRequest({ ...options, modelId, effort });
        },
        prepareReconnectToStreamRequest,
      }),
    // The two refs are listed for the exhaustive-deps rule's benefit only: a
    // ref object is stable for the component's life, so including them cannot
    // rebuild the transport. `chatId` remains the sole real trigger — which is
    // the whole point, since useChat never adopts a new transport instance.
    [chatId, selectedModelRef, selectedEffortRef],
  );
}

/** The cache invalidations a finished/failed turn triggers. */
export function useChatRefresh(chatId: string, queryClient: QueryClient) {
  const refreshChatList = () => {
    void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
    // TitleService (#78) may have named this chat — refresh the card query
    // ChatHeader falls back to when the row is not in a loaded list page.
    // exact: detail is the parent of …/messages; do not wipe history here.
    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.detail(chatId),
      exact: true,
    });
    // A run completion may have generated this chat's title (TitleService,
    // #78). The rail's pinned card denormalizes that title, so refresh pins
    // too — design D5a: a change to a card field invalidates the pins query.
    void queryClient.invalidateQueries({ queryKey: pinQueryKeys.list() });
  };
  // Compaction (#57) is embedded in this same messages response (#136) — a
  // compaction landing mid-conversation is refreshed "for free" by this same
  // invalidation, with no separate query/cache entry to keep in sync.
  // Memoized because the resume effect depends on it, and a fresh identity
  // each render would re-run that effect every render.
  const refreshChatMessages = useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: chatQueryKeys.messages(chatId),
      }),
    [queryClient, chatId],
  );
  const refreshChatData = () => {
    refreshChatList();
    refreshChatMessages();
  };

  return { refreshChatData, refreshChatMessages };
}

type UseChatEngineArgs = {
  chatId: string;
  chatMessages: Array<UIMessage>;
  transport: DefaultChatTransport<UIMessage>;
  onFinished: () => boolean;
  onTargetSendInterrupted: () => boolean;
  onSendFailed: () => void;
  untrackChat: (chatId: string) => void;
  refreshChatData: () => void;
};

/** The `useChat` call itself, wired to the run-tracking and refresh
 *  callbacks it drives. Placement matters: this must stay a hook called
 *  directly from `ChatSessionContent`'s own render (never moved into a
 *  child component), so `useChat`'s per-`chatId` `Chat` instance keeps
 *  living on this component's fiber. */
export function useChatEngine({
  chatId,
  chatMessages,
  transport,
  onFinished,
  onTargetSendInterrupted,
  onSendFailed,
  untrackChat,
  refreshChatData,
}: UseChatEngineArgs) {
  return useChat({
    id: chatId,
    messages: chatMessages,
    generateId: safeRandomUUID,
    transport,
    // Resume-on-refresh (#49): reconnect only after owner-scoped history has
    // proved the chat exists. A fresh/sending draft never probes early; a
    // `?draft=sent` recovery first waits for the bounded history query. This
    // prevents a speculative 204 from racing persistence while still using
    // the same Chat instance for live error recovery.
    // The SDK's own `resume` effect is deliberately NOT used (see
    // `useChatHistorySync`'s resume effect): it has no cleanup and no
    // re-entrancy guard, so React Strict Mode's double-invoked mount effect
    // calls resumeStream() twice on the same Chat instance. Two concurrent
    // makeRequest() calls then race on the shared `activeResponse`, which the
    // first one clears in its finally — the second dereferences it and
    // throws (#260), and each accumulates its own message state, duplicating
    // the answer (#259).
    resume: false,
    // A completed turn proves the chat exists server-side. The session owner
    // removes the draft marker without routing or remounting, then this refresh
    // lets durable history replace the live projection under stable React keys.
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      // A stream that ended by abort/disconnect/error is NOT a completed
      // turn: a page reload aborts the in-flight fetch, and treating that as
      // finish cleared the recorded draft id during teardown — destroying the
      // refresh-resume path this slice exists to add (found via CI trace
      // diagnostics). The run itself survives server-side; the reloaded page
      // recovers the canonical sent route and resumes it.
      if (isAbort || isDisconnect || isError) {
        if (onTargetSendInterrupted()) {
          refreshChatData();
          return;
        }
        onSendFailed();
        refreshChatData();
        return;
      }
      // The user watched this finish → drop it from the active-run registry so
      // the background poll can't fire a stale "reply ready" if they navigate
      // away right after. A target callback that was already consumed by an
      // interruption is a late duplicate and must remain tracked.
      if (!onFinished()) return;
      untrackChat(chatId);
      refreshChatData();
    },
    // Do NOT untrack here: onError fires for a client-visible fetch/stream
    // error (e.g. a transient disconnect), but the durable run may still be
    // executing server-side regardless of what the client saw (#50) — like
    // the abort/disconnect/error branch of onFinish above, leave the run
    // tracked so the background poll can resolve its true terminal status
    // (completed/failed/expired) instead of silently forgetting a run that
    // might still complete.
    onError: () => {
      if (onTargetSendInterrupted()) {
        refreshChatData();
        return;
      }
      onSendFailed();
      refreshChatData();
    },
  });
}

/** Scrolls the target message into view once it has rendered. */
export function useTargetScrollEffect(
  targetMessageRendered: boolean,
  targetSeq: number | null,
) {
  const scrolledTargetRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (
      !targetMessageRendered ||
      targetSeq === null ||
      scrolledTargetRef.current === targetSeq
    ) {
      return;
    }
    const target = document.getElementById(`msg-${targetSeq}`);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    scrolledTargetRef.current = targetSeq;
  }, [targetMessageRendered, targetSeq]);
}

type UseChatHistorySyncArgs = {
  resume: boolean;
  resumeStream: ReturnType<typeof useChat>["resumeStream"];
  refreshChatMessages: () => void;
  chatMessages: Array<UIMessage>;
  messages: Array<UIMessage>;
  status: ReturnType<typeof useChat>["status"];
  setMessages: ReturnType<typeof useChat>["setMessages"];
};

/** Resume-on-refresh and live first-send recovery (#49), and adopting the
 *  refetched history it triggers (#261). */
export function useChatHistorySync({
  resume,
  resumeStream,
  refreshChatMessages,
  chatMessages,
  messages,
  status,
  setMessages,
}: UseChatHistorySyncArgs) {
  // Driven here instead of via useChat's `resume` prop: the SDK's own effect
  // has no cleanup or re-entrancy guard, so Strict Mode's double-invoked
  // mount effect resumes the same Chat instance twice and the two concurrent
  // requests race on shared state (#259/#260 — see the note at the useChat
  // call in `useChatEngine`). The ref is set synchronously before the call,
  // so the second invocation is a no-op; each route identity has one owner
  // and one Chat instance.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!resume || resumedRef.current) return;
    resumedRef.current = true;
    // Always re-read history once the probe settles, INCLUDING when it answers
    // 204. Verified in the pinned SDK (ai 6.0.217): `reconnectToStream` returns
    // null on 204 and `makeRequest` then returns before the block that fires
    // onFinish — so that path emits no callback at all, and with a 60s
    // staleTime nothing else would refetch. That is precisely the case where
    // the run went terminal between this page's history read and the probe,
    // i.e. where the answer is durable and the log is the only stale thing
    // (#261). Cheap and idempotent otherwise: the adoption below is a no-op
    // when the refetch brings nothing new.
    // Promise.resolve: `resumeStream()` is a promise in the SDK, but wrapping
    // keeps this from depending on that — a stubbed/void-returning
    // implementation must not throw here.
    void Promise.resolve(resumeStream()).finally(refreshChatMessages);
  }, [resume, resumeStream, refreshChatMessages]);

  // Adopt that refetched history — the client half of #261. useChat freezes
  // `messages` at creation (see PersistedChatSession) and never re-adopts a
  // later fetch, and the post-finish `router.replace` does NOT remount this
  // component (key={chatId} is unchanged), so a healed history otherwise never
  // reaches the log: the durable answer sits in the query cache, unread. A
  // resume can leave the log stale in two ways — 204 with no stream at all, or
  // a reconnect that arrives after the run's deltas were already emitted and
  // so replays nothing visible. Both end with the server holding the truth.
  // This is also how an on-demand older page (#187) reaches the transcript:
  // the query grows, adoptServerHistory sees newer coverage or a longer
  // window, and the merged list lands via the same setMessages. Guarded on
  // settled state inside adoptServerHistory: mid-turn the live copy
  // legitimately runs AHEAD of the server (an optimistic user turn, an answer
  // still streaming), and overwriting it there is how duplicated/rewound
  // transcripts happen (#259).
  useEffect(() => {
    const healed = adoptServerHistory({
      status,
      serverMessages: chatMessages,
      liveMessages: messages,
    });
    if (healed !== null) setMessages(healed);
  }, [chatMessages, messages, status, setMessages]);
}

type UseChatPresenceEffectsArgs = {
  status: ReturnType<typeof useChat>["status"];
  messages: Array<UIMessage>;
  chatId: string;
  trackRun: (runId: string, chatId: string, label: string) => void;
  markChatSeen: (chatId: string) => void;
};

/** Registers the active run globally (for cross-chat completion toasts) and
 *  clears this chat's unseen badge on open. */
export function useChatPresenceEffects({
  status,
  messages,
  chatId,
  trackRun,
  markChatSeen,
}: UseChatPresenceEffectsArgs) {
  // Register the active run globally so its completion notifies (toast + badge)
  // if the user navigates to another chat before it finishes — the durable
  // worker keeps generating regardless (#50). Label the toast with the first
  // user turn, so "Reply ready — <question>" is meaningful.
  useEffect(() => {
    if (status !== "streaming" && status !== "submitted") return;
    const runId = streamingRunId(messages);
    if (!runId) return;
    trackRun(runId, chatId, notificationLabel(messages));
  }, [status, messages, chatId, trackRun]);

  // Opening a chat clears its unseen-completion badge.
  useEffect(() => {
    markChatSeen(chatId);
  }, [chatId, markChatSeen]);
}
