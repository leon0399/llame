import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useChatContext, type PermissionMode } from "@/contexts/chat-context";
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
import { permissionModesQueryKey } from "@/lib/services/permission-modes/queries";
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

/** The model, effort, and permission mode a request must carry, read from the
 * transport's latest-value mirrors when a request is prepared — that read
 * happens in an event-time callback, never while the component renders, which
 * is why it lives here and not inside the options object the transport is
 * built from. */
function resolveSendSelections(
  modelRef: RefObject<string | undefined>,
  effortRef: RefObject<string | undefined>,
  permissionModeRef: RefObject<PermissionMode>,
) {
  const modelId = modelRef.current;
  if (modelId === undefined) {
    // Unreachable in practice (both send affordances are gated on
    // modelReadyForSend), but this narrows undefined → string so a request can
    // never be built without a model.
    throw new Error(NO_MODEL_SELECTED_ERROR);
  }
  return {
    modelId,
    effort: effortRef.current,
    permissionMode: permissionModeRef.current,
  };
}

/** The `DefaultChatTransport` instance, id-stable per `chatId`. */
export function useChatSendTransport(
  chatId: string,
  selectedModel: string | undefined,
  selectedEffort: string | undefined,
) {
  const { getPermissionMode } = useChatContext();
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
  // Permission mode is keyed by this chat id; mirror its latest selection so
  // the id-stable transport reads the mode chosen immediately before sending.
  const selectedPermissionModeRef = useLatestRef(getPermissionMode(chatId));

  return useMemo(
    () =>
      new DefaultChatTransport({
        api: buildChatMessagesUrl(chatId),
        credentials: "include",
        fetch: authAwareFetch,
        prepareSendMessagesRequest: (options) =>
          prepareSendMessagesRequest({
            ...options,
            ...resolveSendSelections(
              selectedModelRef,
              selectedEffortRef,
              selectedPermissionModeRef,
            ),
          }),
        prepareReconnectToStreamRequest,
      }),
    // The refs are listed for the exhaustive-deps rule's benefit only: a ref
    // object is stable for the component's life, so including them cannot
    // rebuild the transport. `chatId` remains the sole real trigger — which is
    // the whole point, since useChat never adopts a new transport instance.
    [chatId, selectedModelRef, selectedEffortRef, selectedPermissionModeRef],
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
  const refreshChatBinding = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.detail(chatId),
      exact: true,
    });
  }, [queryClient, chatId]);

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

  return { refreshChatData, refreshChatMessages, refreshChatBinding };
}

type ApiErrorBody = {
  readonly code?: unknown;
};

function isObjectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function toEnvelope(value: unknown): ApiErrorBody | undefined {
  if (!isObjectValue(value)) return undefined;
  // SAFETY: JSON.parse returns unknown; this cast is narrowed to an object,
  // and callers only read the optional code field.
  return value as ApiErrorBody;
}

function parseErrorEnvelope(text: string): ApiErrorBody | undefined {
  try {
    return toEnvelope(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function isPermissionModeUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const body = parseErrorEnvelope(error.message);
  return body?.code === "permission_mode_not_available";
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

/** A stream that ended by abort/disconnect/error is NOT a completed turn: a
 *  page reload aborts the in-flight fetch, and treating that as finish cleared
 *  the recorded draft id during teardown — destroying the refresh-resume path
 *  this slice adds (found via CI trace diagnostics). The run survives
 *  server-side; the reloaded page recovers the sent route and resumes it. */
function handleChatFinish(
  status: { isAbort: boolean; isDisconnect: boolean; isError: boolean },
  args: UseChatEngineArgs,
): void {
  if (status.isAbort || status.isDisconnect || status.isError) {
    if (args.onTargetSendInterrupted()) {
      args.refreshChatData();
      return;
    }
    args.onSendFailed();
    args.refreshChatData();
    return;
  }
  // The user watched this finish → drop it from the active-run registry so the
  // background poll can't fire a stale "reply ready" if they navigate away. A
  // target callback already consumed by an interruption is a late duplicate.
  if (!args.onFinished()) return;
  args.untrackChat(args.chatId);
  args.refreshChatData();
}

/** Do NOT untrack here: onError fires for a client-visible fetch/stream error
 *  (e.g. a transient disconnect), but the durable run may still be executing
 *  server-side (#50) — leave it tracked so the background poll resolves its
 *  true terminal status. A rejected send whose mode is no longer available
 *  (422) resets this chat to default and refetches the listing. */
function handleChatError(
  error: unknown,
  args: UseChatEngineArgs,
  queryClient: QueryClient,
  setPermissionMode: (chatId: string, mode: PermissionMode) => void,
): void {
  if (isPermissionModeUnavailableError(error)) {
    void queryClient.invalidateQueries({ queryKey: permissionModesQueryKey });
    setPermissionMode(args.chatId, "default");
  }
  if (args.onTargetSendInterrupted()) {
    args.refreshChatData();
    return;
  }
  args.onSendFailed();
  args.refreshChatData();
}

/** The `useChat` call itself, wired to the run-tracking and refresh
 *  callbacks it drives. Placement matters: this must stay a hook called
 *  directly from `ChatSessionContent`'s own render (never moved into a
 *  child component), so `useChat`'s per-`chatId` `Chat` instance keeps
 *  living on this component's fiber. */
export function useChatEngine(args: UseChatEngineArgs) {
  const queryClient = useQueryClient();
  const { setPermissionMode } = useChatContext();

  return useChat({
    id: args.chatId,
    messages: args.chatMessages,
    generateId: safeRandomUUID,
    transport: args.transport,
    // Resume-on-refresh (#49): reconnect only after owner-scoped history has
    // proved the chat exists. The SDK's own `resume` effect is deliberately
    // NOT used (see `useChatHistorySync`'s resume effect): it has no cleanup
    // and no re-entrancy guard, so React Strict Mode's double-invoked mount
    // effect calls resumeStream() twice on the same Chat instance, racing two
    // makeRequest() calls on the shared `activeResponse` (#260) and
    // duplicating the answer (#259).
    resume: false,
    onFinish: (status) => handleChatFinish(status, args),
    onError: (error) =>
      handleChatError(error, args, queryClient, setPermissionMode),
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

function hasSuccessStatus(value: unknown): value is { status: "success" } {
  if (!(value instanceof Object) || !("status" in value)) return false;
  return value.status === "success";
}

function successfulWorkspaceTransitionId(
  part: UIMessage["parts"][number],
): string | null {
  if (!isToolUIPart(part) || part.state !== "output-available") return null;

  const toolName = getToolName(part);
  if (toolName !== "enter_workspace" && toolName !== "exit_workspace") {
    return null;
  }

  if (!hasSuccessStatus(part.output)) return null;
  return part.toolCallId;
}

function useWorkspacePreparationRefresh(
  status: ReturnType<typeof useChat>["status"],
  refreshChatBinding: () => void,
): void {
  const refreshed = useRef(false);

  useEffect(() => {
    if (status === "streaming") {
      if (!refreshed.current) {
        refreshed.current = true;
        refreshChatBinding();
      }
      return;
    }
    if (status === "ready" || status === "error") {
      refreshed.current = false;
    }
  }, [refreshChatBinding, status]);
}

function useWorkspaceTransitionRefresh(
  messages: Array<UIMessage>,
  status: ReturnType<typeof useChat>["status"],
  refreshChatBinding: () => void,
): void {
  const handledIdsRef = useRef<Set<string> | undefined>(undefined);

  useEffect(() => {
    const handledIds = handledIdsRef.current ?? new Set<string>();
    handledIdsRef.current = handledIds;

    let bindingChanged = false;
    for (const message of messages) {
      for (const part of message.parts) {
        const toolCallId = successfulWorkspaceTransitionId(part);
        if (toolCallId === null || handledIds.has(toolCallId)) continue;
        handledIds.add(toolCallId);
        bindingChanged =
          status === "streaming" || status === "submitted" || bindingChanged;
      }
    }

    if (bindingChanged) refreshChatBinding();
  }, [messages, refreshChatBinding, status]);
}

type UseChatPresenceEffectsArgs = {
  status: ReturnType<typeof useChat>["status"];
  messages: Array<UIMessage>;
  chatId: string;
  trackRun: (runId: string, chatId: string, label: string) => void;
  markChatSeen: (chatId: string) => void;
  refreshChatBinding: () => void;
};

/** Registers the active run globally (for cross-chat completion toasts) and
 *  clears this chat's unseen badge on open. */
export function useChatPresenceEffects({
  status,
  messages,
  chatId,
  trackRun,
  markChatSeen,
  refreshChatBinding,
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

  useWorkspacePreparationRefresh(status, refreshChatBinding);
  useWorkspaceTransitionRefresh(messages, status, refreshChatBinding);

  // Opening a chat clears its unseen-completion badge.
  useEffect(() => {
    markChatSeen(chatId);
  }, [chatId, markChatSeen]);
}
