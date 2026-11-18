import type { ChatStatus, UIMessage } from "ai";
import { z } from "zod";

import {
  isInstructionsPart,
  isPromptImportsPart,
} from "@/lib/services/chat/history";

import {
  groupAssistantParts,
  type GroupedAssistantPart,
} from "./group-assistant-parts";

/**
 * Whether a grouped segment paints anything — the single rule `MessageSegments`
 * walks with and `hasVisibleContent` asks ahead of the walk.
 *
 * A provider that withholds the thinking text still returns the block,
 * signed, and it must persist and replay unchanged — but a run of parts that
 * carries no text (at all, or only whitespace) has nothing to show, so it
 * renders no panel rather than an empty one.
 *
 * `data-context` covers every server-authored context item, whatever its
 * producer. They are rendered into the MODEL's prompt by the api's
 * context-builder and are never visible chat content, except the
 * `instructions` and `prompt-imports` producers: their chips are the owner's
 * disclosure of the files a trigger loaded, truncated, or had denied (design
 * D9), and of how a prompt's `@` markers resolved. The model-change
 * boundary and the `regenerate` and `interrupted` notices above the message
 * are the only owner-facing surfaces for the other producers, and no segment
 * paints them.
 *
 * `data-run-delivered` is the stream's end-of-segment signal (run-steering
 * D9): the client reads it from the finished message and never paints it. One branch rather than a list of producers, so a
 * producer this build does not know about cannot fall through to the
 * "unsupported part type" span and print debug text into the owner's
 * transcript on reload.
 *
 * A `file` part — an image the owner attached — is not a segment: its
 * thumbnail renders above the bubble (`MessageAttachments`). */
export function isVisibleSegment(segment: GroupedAssistantPart): boolean {
  if (segment.kind === "reasoning") return segment.text.trim() !== "";

  if (segment.part.type === "file") return false;

  if (segment.part.type === "data-run-delivered") return false;

  if (segment.part.type === "data-model-retrying") return false;

  if (segment.part.type === "data-context") {
    return (
      isInstructionsPart(segment.part) || isPromptImportsPart(segment.part)
    );
  }

  return true;
}

/**
 * Whether a message's stored parts paint anything at all. An assistant turn
 * with none is either the placeholder of a Run that has produced no output
 * yet, the empty turn a Run failed or cancelled during its model request
 * persists, or a stored turn whose parts all paint nothing — `messageRowMode`
 * separates the first two from a turn that must not show a row.
 */
export function hasVisibleContent(parts: UIMessage["parts"]): boolean {
  return groupAssistantParts(parts).some(isVisibleSegment);
}

const RETRY_LABELS = {
  overloaded: "provider overload",
  server_error: "a provider error",
  unreachable: "a connection failure",
  rate_limited: "a rate limit",
  quota_exhausted: "a usage limit",
  first_token_timeout: "a first-token timeout",
  stream_broken: "a broken stream",
};

const retryNoticeSchema = z.object({
  code: z.string(),
  retry: z.number().int().min(1).max(10),
});

function isRetryCode(code: string): code is keyof typeof RETRY_LABELS {
  return Object.hasOwn(RETRY_LABELS, code);
}

export function requestRetryLabel(
  part: UIMessage["parts"][number] | undefined,
  status: ChatStatus,
): string | undefined {
  if (status !== "submitted" && status !== "streaming") return undefined;

  if (part?.type !== "data-model-retrying") return undefined;

  const parsed = retryNoticeSchema.safeParse(part.data);

  if (!parsed.success || !isRetryCode(parsed.data.code)) return undefined;

  return `Retrying after ${RETRY_LABELS[parsed.data.code]} (${parsed.data.retry}/10)`;
}

