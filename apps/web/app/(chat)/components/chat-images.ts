import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";

import {
  isPromptImportsPart,
  messageRenderKey,
} from "@/lib/services/chat/history";
import type { MediaOccurrence } from "@/lib/services/media/lightbox";
import { mediaIdFromLocator } from "@/lib/services/media/urls";

/** The lightbox key of one image in the transcript: the message, the part
 *  carrying it, and the entry within that part (prompt imports carry many). */
export function chatImageKey(
  messageKey: string,
  partIndex: number,
  entryIndex = 0,
): string {
  return `${messageKey}#${partIndex}.${entryIndex}`;
}

/** The part of a `read` image result the transcript needs: its locator. */
const imageReadResultSchema = z.object({
  status: z.literal("success"),
  kind: z.literal("image"),
  media: z.string(),
});

/** The `media://` locator of a completed `read` part whose result is an
 *  image, or `null` for any other part. */
export function readImageLocator(
  part: UIMessage["parts"][number],
): string | null {
  if (!isToolUIPart(part) || getToolName(part) !== "read") return null;
  if (part.state !== "output-available") return null;
  const media = imageReadResultSchema.safeParse(part.output).data?.media;
  if (media === undefined || mediaIdFromLocator(media) === null) return null;
  return media;
}

/** One message's images in the order the row paints them: an owner's
 *  attachments above the bubble, then the `read` results and prompt-import
 *  images inside it in stored order. Only `media://` locators count; anything
 *  else has no stored image to show. */
function messageImages(message: UIMessage): Array<MediaOccurrence> {
  const messageKey = messageRenderKey(message);
  const attachments: Array<MediaOccurrence> = [];
  const inBubble: Array<MediaOccurrence> = [];
  message.parts.forEach((part, partIndex) => {
    if (part.type === "file") {
      if (message.role === "user" && mediaIdFromLocator(part.url) !== null) {
        attachments.push({
          key: chatImageKey(messageKey, partIndex),
          locator: part.url,
        });
      }
      return;
    }
    const readLocator = readImageLocator(part);
    if (readLocator !== null) {
      inBubble.push({
        key: chatImageKey(messageKey, partIndex),
        locator: readLocator,
      });
      return;
    }
    if (!isPromptImportsPart(part)) return;
    part.data.payload.imports.forEach((entry, entryIndex) => {
      if (entry.media === undefined) return;
      inBubble.push({
        key: chatImageKey(messageKey, partIndex, entryIndex),
        locator: entry.media,
      });
    });
  });
  return [...attachments, ...inBubble];
}

/** Every image in the transcript, in transcript order: the chat lightbox's
 *  slides. */
export function chatImages(
  messages: ReadonlyArray<UIMessage>,
): Array<MediaOccurrence> {
  return messages.flatMap(messageImages);
}
