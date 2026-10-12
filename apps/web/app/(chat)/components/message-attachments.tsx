import { ImageThumbnailRow } from "@workspace/ui/components/custom/image-thumbnail";
import type { UIMessage } from "ai";

import { mediaVariantUrl } from "@/lib/services/media/urls";

/** A user message's attached images as read-only thumbnails above its bubble,
 *  in stored order, each loading the `/model` variant lazily. File parts
 *  without a `media://` locator have nothing to load and are skipped. */
export function MessageAttachments({ message }: { message: UIMessage }) {
  if (message.role !== "user") return null;
  const items = message.parts.flatMap((part, index) => {
    if (part.type !== "file") return [];
    const src = mediaVariantUrl(part.url, "model");
    if (src === null) return [];
    return [
      { key: String(index), src, alt: part.filename ?? "Attached image" },
    ];
  });
  if (items.length === 0) return null;
  return (
    <ImageThumbnailRow
      aria-label="Attached images"
      className="ml-auto w-fit justify-end"
      items={items}
    />
  );
}
