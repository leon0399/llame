/**
 * When the latest turn offers Continue and Regenerate (turn-actions D13), and
 * which stored calls a Regenerate discards. Pure — no hooks, no JSX — so the
 * rules are unit-testable and the row only paints what they say.
 */

import { getToolName, isToolUIPart, type ChatStatus, type UIMessage } from "ai";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import {
  messageSeqFromMetadata,
  runIdFromMessageMetadata,
} from "@/lib/services/chat/history";
import { isTerminalRunStatus } from "@/lib/services/chat/run-notifications";

import { parseTurnUsage } from "./message-usage";

export type TurnActionVisibility = {
  continueTurn: boolean;
};

/** The reply a turn's actions judge: its recorded usage and its stored parts.
 *  A `UIMessage` satisfies it — the SDK makes `metadata` optional. */
export type TurnReply = {
  metadata?: unknown;
  parts: UIMessage["parts"];
};

/** A settled tool part: it holds its result — the step boundary a Continue
 *  resumes from. */
export type SettledToolPart = Extract<
  UIMessage["parts"][number],
  { type: `tool-${string}` }
>;

export function isSettledToolPart(
  part: UIMessage["parts"][number],
): part is SettledToolPart {
  if (!isToolUIPart(part)) return false;
  return part.state === "output-available" || part.state === "output-error";
}

/** A request is only prepared from a settled chat: a follow-up started while
 *  another request streams would race it (the SDK has no in-flight guard). */
function isActionableStatus(status: ChatStatus): boolean {
  return status === "ready" || status === "error";
}

/**
 * Whether a Regenerate would discard a call whose effects outlive the reply. A
 * recorded `read_only` call and a call that never started are disregarded; a
 * legacy part with no classification counts, because this build has no tool
 * catalog to clear it.
 */
function discardsEffects(part: SettledToolPart): boolean {
  const classification =
    "classification" in part ? part.classification : undefined;
  return classification !== "read_only" && classification !== null;
}

/** The tools a Regenerate would discard, each named once, in stored order. */
export function discardedCallNames(parts: UIMessage["parts"]): Array<string> {
  const names = new Set<string>();
  for (const part of parts) {
    if (isSettledToolPart(part) && discardsEffects(part)) {
      names.add(getToolName(part));
    }
  }
  return [...names];
}

/** Continue needs the reply the latest Run produced, still short of
 *  `completed`, and at least one settled tool part to resume from. */
function continuesTurn(
  latestRun: ChatLatestRunResponse,
  reply: TurnReply,
): boolean {
  if (latestRun.status === "completed") return false;
  if (runIdFromMessageMetadata(reply.metadata) !== latestRun.id) return false;
  if (parseTurnUsage(reply.metadata)?.status === "completed") return false;
  return reply.parts.some(isSettledToolPart);
}

/**
 * The actions the latest turn offers, or null for none: nothing while a
 * request is in flight, nothing while the latest Run still executes, and
 * nothing for a Chat with no Run. A terminal Run always offers Regenerate; a
 * turn that left no reply passes `reply: null` and gets Regenerate alone.
 */
export function turnActionVisibility(input: {
  latestRun: ChatLatestRunResponse | null;
  reply: TurnReply | null;
  status: ChatStatus;
}): TurnActionVisibility | null {
  const { latestRun, reply, status } = input;
  if (!isActionableStatus(status)) return null;
  if (latestRun === null || !isTerminalRunStatus(latestRun.status)) return null;
  return {
    continueTurn: reply !== null && continuesTurn(latestRun, reply),
  };
}

/** The index of the turn's user message, which the Chat's newest Run names, or
 *  -1 when the window does not hold it (an older `#msg-N` view, a slid page). */
function turnUserIndex(
  messages: ReadonlyArray<UIMessage>,
  latestRun: ChatLatestRunResponse,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.id === latestRun.messageId) {
      return index;
    }
  }
  return -1;
}

/**
 * Whether the transcript's last row is the latest turn's reply, so it may
 * carry that turn's actions. The Run must name the row's own user message:
 * a `#msg-N` view of an older turn ends on an older reply, and an older turn
 * MUST NOT show either action.
 */
export function carriesTurnActions(input: {
  messages: ReadonlyArray<UIMessage>;
  latestRun: ChatLatestRunResponse | null;
  status: ChatStatus;
}): boolean {
  const { messages, latestRun, status } = input;
  if (!isActionableStatus(status)) return false;
  if (latestRun === null || !isTerminalRunStatus(latestRun.status)) {
    return false;
  }
  const reply = messages.at(-1);
  if (reply === undefined || reply.role !== "assistant") return false;
  return turnUserIndex(messages, latestRun) === messages.length - 2;
}

/**
 * Whether the latest turn needs the minimal failed-turn row: its Run ended
 * without leaving a reply, so there is no answer row to carry the action. The
 * stream still pushes an empty placeholder when the Run fails at pickup, and
 * history adoption keeps it — a live-authored assistant message with no parts.
 */
export function needsFailedTurnRow(input: {
  messages: ReadonlyArray<UIMessage>;
  latestRun: ChatLatestRunResponse | null;
  status: ChatStatus;
}): boolean {
  const { messages, latestRun, status } = input;
  if (!isActionableStatus(status)) return false;
  if (latestRun === null || !isTerminalRunStatus(latestRun.status)) {
    return false;
  }
  const userIndex = turnUserIndex(messages, latestRun);
  if (userIndex === -1) return false;
  return messages
    .slice(userIndex + 1)
    .every(
      (message) =>
        message.role === "assistant" &&
        message.parts.length === 0 &&
        messageSeqFromMetadata(message.metadata) === null,
    );
}

/**
 * The index of the latest turn's reply while a follow-up Run of that turn has
 * not settled: the api keeps the replaced reply until the follow-up Run
 * dispatches, so a reload before that dispatch would show the old answer
 * beside the resumed stream (D13). The reply is found by its turn, not by
 * position, because the resumed stream attaches as a new trailing message
 * (its id is the Run's, so the SDK pushes rather than replaces). A live
 * placeholder carries no durable seq, and the follow-up Run's own pending
 * reply names that Run, so neither is hidden.
 */
export function hiddenFollowUpReplyIndex(
  messages: ReadonlyArray<UIMessage>,
  latestRun: ChatLatestRunResponse | null,
): number | null {
  if (latestRun === null || latestRun.followUpAction === null) return null;
  if (isTerminalRunStatus(latestRun.status)) return null;
  const userIndex = turnUserIndex(messages, latestRun);
  if (userIndex === -1) return null;
  const replyIndex = userIndex + 1;
  const reply = messages[replyIndex];
  if (reply === undefined || reply.role !== "assistant") return null;
  if (messageSeqFromMetadata(reply.metadata) === null) return null;
  return runIdFromMessageMetadata(reply.metadata) === latestRun.id
    ? null
    : replyIndex;
}
