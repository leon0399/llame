/**
 * Whether a stored assistant turn paints anything. Pure and component-free, so
 * both the row that renders a reply (`chat-message-row`) and the rules that
 * decide whether that reply can carry the turn's actions
 * (`turn-action-rules`) ask the same question.
 */

import type { UIMessage } from "ai";

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
 * boundary above the message remains the only owner-facing surface for the
 * other producers. One branch rather than a list of producers, so a
 * producer this build does not know about cannot fall through to the
 * "unsupported part type" span and print debug text into the owner's
 * transcript on reload.
 *
 * A `file` part — an image the owner attached — is not a segment: its
 * thumbnail renders above the bubble (`MessageAttachments`). */
export function isVisibleSegment(segment: GroupedAssistantPart): boolean {
  if (segment.kind === "reasoning") return segment.text.trim() !== "";
  if (segment.part.type === "file") return false;
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
