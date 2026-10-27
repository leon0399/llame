/**
 * When the latest turn offers Continue and Regenerate (turn-actions D13), and
 * which stored calls a Regenerate discards. Pure — no hooks, no JSX — so the
 * rules are unit-testable and the row only paints what they say.
 */

import { getToolName, isToolUIPart, type UIMessage } from "ai";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import {
  messageSeqFromMetadata,
  runIdFromMessageMetadata,
} from "@/lib/services/chat/history";

import { parseTurnUsage } from "./message-usage";

/** A Run that will not change again on its own. */
const TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

/** The statuses Continue resumes: the Run ended before its answer finished. */
const CONTINUABLE_RUN_STATUSES = ["failed", "cancelled", "expired"] as const;

export type TurnActionVisibility = {
  continueTurn: boolean;
  regenerate: boolean;
};

const NO_ACTIONS: TurnActionVisibility = {
  continueTurn: false,
  regenerate: false,
};

/** The reply a turn's actions judge: its recorded usage and its stored parts. */
export type TurnReply = {
  metadata: unknown;
  parts: UIMessage["parts"];
};

/** Whether the Run has reached a status it cannot leave by itself. */
export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.some((terminal) => terminal === status);
}

function isContinuableRunStatus(status: string): boolean {
  return CONTINUABLE_RUN_STATUSES.some((continuable) => continuable === status);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** A settled tool part: one that holds its result, success or error — the step
 *  boundary a Continue resumes from. */
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

/** The classification an api-stored tool part recorded: `undefined` for a
 *  legacy part written before the field existed, `null` for a call that never
 *  started. */
function recordedClassification(
  part: SettledToolPart,
): string | null | undefined {
  if (!("classification" in part)) return undefined;
  const classification = part.classification;
  if (classification === null) return null;
  return isString(classification) ? classification : undefined;
}

/**
 * Whether a Regenerate would discard a call whose effects outlive the reply.
 * A recorded `read_only` call and a call that never started are disregarded; a
 * legacy part with no classification counts, because this build has no tool
 * catalog to clear it.
 */
function discardsEffects(part: SettledToolPart): boolean {
  const classification = recordedClassification(part);
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
  if (!isContinuableRunStatus(latestRun.status)) return false;
  if (runIdFromMessageMetadata(reply.metadata) !== latestRun.id) return false;
  if (parseTurnUsage(reply.metadata)?.status === "completed") return false;
  return reply.parts.some(isSettledToolPart);
}

/**
 * The actions the latest turn offers: Continue only on a reply its own Run
 * produced and left unfinished, Regenerate whenever that Run is terminal. A
 * turn with no reply offers Regenerate alone.
 */
export function turnActionVisibility(input: {
  latestRun: ChatLatestRunResponse | null;
  reply: TurnReply | null;
}): TurnActionVisibility {
  const { latestRun, reply } = input;
  if (latestRun === null || !isTerminalRunStatus(latestRun.status)) {
    return NO_ACTIONS;
  }
  return {
    continueTurn: reply !== null && continuesTurn(latestRun, reply),
    regenerate: true,
  };
}

/**
 * The index of the latest turn's reply while a follow-up Run of that turn has
 * not settled: the api keeps the replaced reply until the follow-up Run
 * dispatches, so a reload before that dispatch would show the old answer
 * beside the resumed stream (D13). A live placeholder is not a reply — it
 * carries no durable seq — and the follow-up Run's own pending reply names
 * that Run, so neither is hidden.
 */
export function replacedReplyIndex(
  messages: ReadonlyArray<UIMessage>,
  latestRun: ChatLatestRunResponse | null,
): number | null {
  if (latestRun === null || latestRun.followUpAction === null) return null;
  if (isTerminalRunStatus(latestRun.status)) return null;
  const index = messages.length - 1;
  const message = messages[index];
  if (message === undefined || message.role !== "assistant") return null;
  if (messageSeqFromMetadata(message.metadata) === null) return null;
  return runIdFromMessageMetadata(message.metadata) === latestRun.id
    ? null
    : index;
}

/**
 * Whether the latest turn needs the minimal failed-turn row: its Run ended
 * without leaving a reply, so there is no answer row to carry the action.
 */
export function needsFailedTurnRow(
  messages: ReadonlyArray<UIMessage>,
  latestRun: ChatLatestRunResponse | null,
): boolean {
  if (latestRun === null || !isTerminalRunStatus(latestRun.status)) {
    return false;
  }
  const last = messages.at(-1);
  return (
    last !== undefined &&
    last.role === "user" &&
    last.id === latestRun.messageId
  );
}
