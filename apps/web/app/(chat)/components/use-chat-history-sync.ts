/**
 * Resume-on-refresh and live first-send recovery (#49), re-attaching after an
 * interrupted stream (#1284), and adopting the refetched history it triggers
 * (#261). Split out of `use-chat-engine.ts` when its own effects and the send
 * plumbing together outgrew that module's line budget.
 */

import { useCallback, useEffect, useRef } from "react";

import type { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import {
  adoptServerHistory,
  replacementContext,
} from "@/lib/services/chat/history-adoption";
import {
  useStreamRepair,
  type StreamInterruption,
} from "@/lib/services/chat/stream-repair";

import { streamingRunId } from "@/lib/services/chat/run-notifications";

type UseChatHistorySyncArgs = {
  resume: boolean;
  resumeStream: ReturnType<typeof useChat>["resumeStream"];
  refreshChatMessages: () => void;
  chatMessages: Array<UIMessage>;
  messages: Array<UIMessage>;
  status: ReturnType<typeof useChat>["status"];
  setMessages: ReturnType<typeof useChat>["setMessages"];
  /** The Chat's newest Run, which tells an in-place reply replacement (a
   *  follow-up) from a plain append. */
  latestRun: ChatLatestRunResponse | null;
  /** The Run whose stream ended while it was still executing (see
   *  `isInterruptedStream`), or null. */
  interruption: StreamInterruption | null;
};

/** Resume-on-refresh and live first-send recovery (#49), re-attaching after an
 *  interrupted stream (#1284), and adopting the refetched history it triggers
 *  (#261). */
export function useChatHistorySync({
  resume,
  resumeStream,
  refreshChatMessages,
  chatMessages,
  messages,
  status,
  setMessages,
  latestRun,
  interruption,
}: UseChatHistorySyncArgs) {
  // One attach per mount for the `resume` probe; the repair below claims the
  // same slot so the two cannot race two reconnects on the same Chat instance
  // (#259/#260 — see the note at the useChat call in `useChatEngine`).
  const attachedRef = useRef(false);

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
  const attach = useCallback(() => {
    void Promise.resolve(resumeStream()).finally(refreshChatMessages);
  }, [resumeStream, refreshChatMessages]);

  // Driven here instead of via useChat's `resume` prop: the SDK's own effect
  // has no cleanup or re-entrancy guard, so Strict Mode's double-invoked
  // mount effect resumes the same Chat instance twice and the two concurrent
  // requests race on shared state (#259/#260 — see the note at the useChat
  // call in `useChatEngine`). Each route identity has one owner and one Chat
  // instance.
  useEffect(() => {
    if (!resume || attachedRef.current) return;
    attachedRef.current = true;
    attach();
  }, [resume, attach]);

  // The repair episode itself — immediate first attempt, equal-jitter retries,
  // capped — lives in its own module. This hook owns only the attach and the
  // slot the probe below shares with it (#1284).
  const claimAttachSlot = useCallback(() => {
    attachedRef.current = true;
  }, []);
  useStreamRepair({
    attach,
    interruption,
    currentRunId: streamingRunId(messages),
    healthy: status === "streaming",
    onAttempt: claimAttachSlot,
  });

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
      replacement: replacementContext({ status, latestRun }),
    });
    if (healed !== null) setMessages(healed);
  }, [chatMessages, messages, status, latestRun, setMessages]);
}
