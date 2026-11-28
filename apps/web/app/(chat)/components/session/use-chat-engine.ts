/**
 * The lower-level chat plumbing `useChatConversation` composes: model
 * readiness, the send transport, cache refresh, the AG-UI chat engine itself,
 * and its adjacent effects (scroll-to-target, resume/history-adoption,
 * run-presence). Split into its own module once `use-chat-conversation.ts`
 * outgrew the project's 500-line cap.
 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

import { getToolName, isToolUIPart, type ChatStatus, type UIMessage } from "ai";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  useChatContext,
  type ComposerPicks,
  type PermissionMode,
} from "@/contexts/chat-context";
import { useLatestRef } from "@/lib/hooks/use-latest-ref";
import type {
  ChatRequest,
  ChatTransport,
} from "@/lib/services/chat/ag-ui/chat";
import { createChatTransport } from "@/lib/services/chat/ag-ui/transport";
import { useAgUiChat } from "@/lib/services/chat/ag-ui/use-ag-ui-chat";
import {
  type ChatTransportRequestOptions,
  type PreparedChatRequest,
  prepareSendMessagesRequest,
} from "@/lib/services/chat/transport";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import { pinQueryKeys } from "@/lib/services/pins/queries";
import type {
  ComposerSelection,
  SendSelection,
} from "@/lib/services/models/selection";

import { parseTurnUsage } from "../transcript/message-usage";
import {
  permissionModesQueryKey,
  type PermissionModesResponse,
  usePermissionModesQuery,
} from "@/lib/services/permission-modes/queries";
import {
  notificationLabel,
  deliveredMessageId,
  streamingRunId,
  isInterruptedStream,
  type StreamCompletion,
} from "@/lib/services/chat/run-notifications";
import { safeRandomUUID } from "@/lib/uuid";

/** The permission mode the composer restores to, decided only from the settled
 *  listing and the last turn's recorded mode — the model catalog plays no part
 *  in this half of the restore, so a slow catalog can neither delay nor
 *  clobber the restore. `bypass` restores only while still offered; anything
 *  else (withdrawn, missing, or errored listing) is `default`. Pure — no
 *  hooks; the single owner of the permission rule. */
export function resolveRestoredPermissionMode(
  modes: PermissionModesResponse["modes"],
  lastPermissionMode: "bypass" | undefined,
): PermissionMode {
  return lastPermissionMode === "bypass" &&
    modes.some(({ value }) => value === "bypass")
    ? "bypass"
    : "default";
}

/** The permission mode the chat's last recorded turn used, read from the
 *  persisted per-turn telemetry (`message.metadata.usage`), newest first, so
 *  an unanswered trailing user prompt falls back to the last completed
 *  assistant turn. `undefined` when no message records a turn (an empty or
 *  legacy-only chat). */
function lastTurnPermissionMode(
  messages: ReadonlyArray<UIMessage>,
): "bypass" | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = parseTurnUsage(messages[index]?.metadata);

    if (!usage || usage.modelId === undefined) continue;

    return usage.permissionMode;
  }

  return undefined;
}

/** Restores this chat's last-used permission mode for an existing chat on the
 *  live view. The model and effort need no restore: they come from the Chat's
 *  stored selection, which the page reads. The mode restores only when the
 *  listing has settled, so `bypass` is held back (not treated as withdrawn)
 *  while it is still loading and restored when the operator still offers it.
 *  A brand-new chat, a target-window view, and the live view an accepted
 *  `#msg-N` send (finished or interrupted) remounts never restore: after that
 *  send the composer already holds the mode the newest turn used, while the
 *  cached history can still be the pre-send snapshot (#1084). */
type UseChatPermissionRestoreArgs = {
  chatId: string;
  chatMessages: ReadonlyArray<UIMessage>;
  initialChatExists: boolean;
  mountedAfterTargetSend: boolean;
  targetSeq: number | null;
};

export function useChatPermissionRestore({
  chatId,
  chatMessages,
  initialChatExists,
  mountedAfterTargetSend,
  targetSeq,
}: UseChatPermissionRestoreArgs) {
  const { setPermissionMode } = useChatContext();
  const permissionModesQuery = usePermissionModesQuery();
  const appliedRef = useRef(false);

  const skipMount =
    !initialChatExists || targetSeq !== null || mountedAfterTargetSend;

  useEffect(() => {
    if (skipMount || appliedRef.current) return;

    if (chatMessages.length === 0) return;

    if (permissionModesQuery.isPending) return; // not settled yet
    appliedRef.current = true;
    setPermissionMode(
      chatId,
      resolveRestoredPermissionMode(
        permissionModesQuery.data?.modes ?? [],
        lastTurnPermissionMode(chatMessages),
      ),
    );
  }, [
    skipMount,
    chatId,
    chatMessages,
    permissionModesQuery.isPending,
    permissionModesQuery.data,
    setPermissionMode,
  ]);
}

/** What one request carries into the accepted-send callback. */
type AcceptedSendSnapshot = {
  selection: ComposerSelection | null;
  picks: ComposerPicks;
};

/** What the id-stable transport reads at request time. */
export type ChatSendSelection = {
  send: SendSelection;
  accepted: ComposerSelection | null;
};

/** Prepare request fields and the matching selection snapshot atomically. */
export function prepareChatRequest(
  options: ChatRequest,
  selections: {
    send: RefObject<SendSelection>;
    accepted: RefObject<ComposerSelection | null>;
    picks: RefObject<ComposerPicks>;
    permissionMode: RefObject<PermissionMode>;
  },
): PreparedChatRequest & { accepted: AcceptedSendSnapshot } {
  const send = selections.send.current;
  const picks = selections.picks.current;

  return {
    ...prepareSendMessagesRequest({
      chatId: options.chatId,
      messages: options.messages,
      trigger: options.trigger,
      followUp: options.body,
      selector: send.selector,
      effort: send.effort,
      permissionMode: selections.permissionMode.current,
    } satisfies ChatTransportRequestOptions),
    accepted: { selection: selections.accepted.current, picks },
  };
}

/**
 * A plain Regenerate (and Continue) names neither selector nor effort, so it
 * must not retire a pick the owner made for a later send.
 */
function acceptedSendCallback(
  accept: (selection: ComposerSelection | null, picks: ComposerPicks) => void,
) {
  return (request: ChatRequest, snapshot: AcceptedSendSnapshot) => {
    const namesSelection =
      request.body !== undefined &&
      ("selector" in request.body || "effort" in request.body);

    if (request.trigger === "regenerate-message" && !namesSelection) return;

    accept(snapshot.selection, snapshot.picks);
  };
}

/** The Chat's AG-UI transport, id-stable per `chatId`. */
export function useChatSendTransport(
  chatId: string,
  composer: ChatSendSelection,
) {
  const { getPermissionMode, acceptSend, picks } = useChatContext();

  // The id-stable transport reads all request-time values from latest refs.
  const sendRef = useLatestRef(composer.send);
  const acceptedRef = useLatestRef(composer.accepted);
  const picksRef = useLatestRef(picks);
  const selectedPermissionModeRef = useLatestRef(getPermissionMode(chatId));

  const onAccepted = useMemo(
    () => acceptedSendCallback(acceptSend),
    [acceptSend],
  );

  return useMemo(
    () =>
      createChatTransport(
        (request) =>
          prepareChatRequest(request, {
            send: sendRef,
            accepted: acceptedRef,
            picks: picksRef,
            permissionMode: selectedPermissionModeRef,
          }),
        onAccepted,
      ),
    [onAccepted, acceptedRef, picksRef, selectedPermissionModeRef, sendRef],
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
  transport: ChatTransport;
  onFinished: () => boolean;
  onTargetSendInterrupted: () => boolean;
  onSendFailed: () => void;
  /** The run a just-ended stream belonged to, when that stream ended while the
   *  run was still executing (see `isInterruptedStream`). */
  onStreamInterrupted: (runId: string | null) => void;
  /** The stream of a Run segment ended at a delivered message; the Run goes
   *  on (run-steering D9). */
  onSegmentDelivered: (messageId: string) => void;
  untrackChat: (chatId: string) => void;
  refreshChatData: () => void;
};

/** A stream that ended by abort/disconnect/error/truncation is NOT a completed
 *  turn: a page reload aborts the in-flight fetch, and treating that as finish
 *  cleared the recorded draft id during teardown — destroying the refresh-resume
 *  path this slice adds (found via CI trace diagnostics). The run survives
 *  server-side; the reloaded page recovers the sent route and resumes it. */
function handleChatFinish(
  status: StreamCompletion,
  args: UseChatEngineArgs,
): void {
  if (
    status.isAbort ||
    status.isDisconnect ||
    status.isError ||
    status.finishReason === undefined
  ) {
    // Re-attach before the draft/history path below gets a chance to: for a
    // chat whose mount probe already ran, that path recovers nothing, which is
    // what left a long turn dead until a manual reload.
    if (isInterruptedStream(status)) {
      args.onStreamInterrupted(streamingRunId(status.messages));
    }

    if (args.onTargetSendInterrupted()) {
      args.refreshChatData();

      return;
    }

    args.onSendFailed();
    args.refreshChatData();

    return;
  }

  // A delivery ends the segment, not the Run: it neither finished the turn nor
  // left the registry's tracked run behind, and the next segment attaches once
  // history holds the delivered message.
  const deliveredId = deliveredMessageId(status.message);

  if (deliveredId !== null) {
    args.onSegmentDelivered(deliveredId);

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

/** The AG-UI chat engine itself, wired to the run-tracking and refresh
 *  callbacks it drives. Placement matters: this must stay a hook called
 *  directly from `ChatSessionContent`'s own render (never moved into a
 *  child component), so the per-`chatId` chat instance keeps living on this
 *  component's fiber. */
export function useChatEngine(args: UseChatEngineArgs) {
  const queryClient = useQueryClient();
  const { setPermissionMode } = useChatContext();

  // Resume-on-refresh (#49) is driven by `useChatHistorySync`, which
  // reconnects only after owner-scoped history has proved the chat exists.
  return useAgUiChat({
    id: args.chatId,
    messages: args.chatMessages,
    generateId: safeRandomUUID,
    transport: args.transport,
    onFinish: (status) => handleChatFinish(status, args),
    onError: (error) =>
      handleChatError(error, args, queryClient, setPermissionMode),
  });
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
  status: ChatStatus,
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
  status: ChatStatus,
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
  status: ChatStatus;
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
