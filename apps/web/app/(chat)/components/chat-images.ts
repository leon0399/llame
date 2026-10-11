import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";

import { imageOutputSchema } from "@workspace/ui/components/custom/read";
import { inlineThumbnailSchema } from "@workspace/ui/lib/inline-thumbnail";

import {
  isPromptImportsPart,
  messageRenderKey,
  type PromptImportsPayload,
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

/** The locator the model submitted to `read`: its input `path`. */
const readInputSchema = z.object({ path: z.string() });

/** An unstored image's original, as its result or import entry records it. */
type UnstoredImage = {
  thumbnail: string;
  width: number;
  height: number;
  mediaType: string;
};

/** The single-variant occurrence of an unstored image, captioned with the
 *  locator as submitted. */
function unstoredOccurrence(
  key: string,
  { thumbnail, width, height, mediaType }: UnstoredImage,
  locator: string,
): MediaOccurrence {
  return {
    key,
    slide: {
      kind: "unstored",
      thumbnail,
      width,
      height,
      mediaType,
      locator,
      alt: locator,
    },
  };
}

/** The lightbox occurrence of a completed `read` part whose result is an
 *  image, or `null` for any other part. A stored image is named by its
 *  `media://` locator; an unstored one is captioned with the locator the
 *  model submitted, never the resolved `path`. */
function readImageOccurrence(
  part: UIMessage["parts"][number],
  key: string,
): MediaOccurrence | null {
  if (!isToolUIPart(part) || getToolName(part) !== "read") return null;
  if (part.state !== "output-available") return null;
  const result = imageOutputSchema.safeParse(part.output).data;
  if (result === undefined) return null;
  if (result.media !== undefined) {
    return mediaIdFromLocator(result.media) === null
      ? null
      : { key, media: result.media };
  }
  const thumbnail = inlineThumbnailSchema.safeParse(result.thumbnail).data;
  const locator = readInputSchema.safeParse(part.input).data?.path;
  if (thumbnail === undefined || locator === undefined) return null;
  return unstoredOccurrence(key, { ...result, thumbnail }, locator);
}

/** The images of a validated prompt-imports part, in entry order: a stored
 *  entry by its `media://` locator, an unstored one captioned with the
 *  locator the owner wrote. */
function promptImportOccurrences(
  imports: PromptImportsPayload["imports"],
  messageKey: string,
  partIndex: number,
): Array<MediaOccurrence> {
  return imports.flatMap((entry, entryIndex) => {
    const key = chatImageKey(messageKey, partIndex, entryIndex);
    if (entry.media !== undefined) return [{ key, media: entry.media }];
    if (entry.thumbnail === undefined) return [];
    return [unstoredOccurrence(key, entry, entry.locator)];
  });
}

/** One message's images in the order the row paints them: an owner's
 *  attachments above the bubble, then the `read` results and prompt-import
 *  images inside it in stored order. Attachments count only with a
 *  `media://` locator; results and imports with one or an inline thumbnail. */
function messageImages(message: UIMessage): Array<MediaOccurrence> {
  const messageKey = messageRenderKey(message);
  const attachments: Array<MediaOccurrence> = [];
  const inBubble: Array<MediaOccurrence> = [];
  message.parts.forEach((part, partIndex) => {
    const key = chatImageKey(messageKey, partIndex);
    if (part.type === "file") {
      if (message.role === "user" && mediaIdFromLocator(part.url) !== null) {
        attachments.push({ key, media: part.url });
      }
      return;
    }
    const readImage = readImageOccurrence(part, key);
    if (readImage !== null) inBubble.push(readImage);
    else if (isPromptImportsPart(part)) {
      inBubble.push(
        ...promptImportOccurrences(
          part.data.payload.imports,
          messageKey,
          partIndex,
        ),
      );
    }
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
