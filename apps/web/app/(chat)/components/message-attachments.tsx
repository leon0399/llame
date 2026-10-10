import { ImageThumbnailRow } from "@workspace/ui/components/custom/image-thumbnail";
import type { UIMessage } from "ai";

import { messageRenderKey } from "@/lib/services/chat/history";
import { mediaVariantUrl } from "@/lib/services/media/urls";

import { chatImageKey } from "./chat-images";
import { useOpenChatImage } from "./chat-lightbox";

/** A user message's attached images as thumbnails above its bubble, in
 *  stored order, each loading the `/model` variant lazily and opening the
 *  chat lightbox. File parts without a `media://` locator have nothing to
 *  load and are skipped. */
export function MessageAttachments({ message }: { message: UIMessage }) {
  const openImage = useOpenChatImage();
  if (message.role !== "user") return null;
  const messageKey = messageRenderKey(message);
  const items = message.parts.flatMap((part, index) => {
    if (part.type !== "file") return [];
    const src = mediaVariantUrl(part.url, "model");
    if (src === null) return [];
    return [
      {
        key: chatImageKey(messageKey, index),
        src,
        alt: part.filename ?? "Attached image",
      },
    ];
  });
  if (items.length === 0) return null;
  return (
    <ImageThumbnailRow
      aria-label="Attached images"
      className="ml-auto w-fit justify-end"
      items={items}
      onOpen={openImage ?? undefined}
    />
  );
}
