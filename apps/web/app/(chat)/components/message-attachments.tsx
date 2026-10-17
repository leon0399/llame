"use client";

import { useState } from "react";
import {
  MediaThumbnailRow,
  type MediaThumbnailItem,
} from "@workspace/ui/components/custom/media-thumbnail";
import {
  MediaLightbox,
  type MediaLightboxSlide,
} from "@workspace/ui/components/custom/media-lightbox";
import type { UIMessage } from "ai";

import { storedImageSources } from "@/lib/services/media/urls";

/** Project stored file parts into ordered tiles and an image-only gallery. */
function attachmentViews(parts: UIMessage["parts"]) {
  const items: Array<MediaThumbnailItem> = [];
  const slides: Array<MediaLightboxSlide> = [];
  parts.forEach((part, index) => {
    if (part.type !== "file") return;
    const sources = storedImageSources(part.url);
    if (sources === null) return;
    const key = String(index);
    if (part.mediaType.startsWith("image/")) {
      const alt = part.filename ?? "Attached image";
      items.push({ key, kind: "image", src: sources.thumbnail, alt });
      slides.push({ key, src: sources.original, alt, caption: part.url });
    } else if (part.mediaType === "application/pdf") {
      items.push({
        key,
        kind: "pdf",
        name: part.filename ?? "Attached PDF",
        href: sources.original,
      });
    }
  });
  return { items, slides };
}

/** A user message's attached images and PDFs as thumbnails above its bubble,
 *  in stored order. An image loads the `/model` variant lazily and opens a
 *  lightbox over this message's images, which shows the `/original`
 *  captioned with the `media://` locator; a PDF shows a document tile named
 *  by its stored file name, whose tile links the `/original` in a new tab,
 *  and never enters the lightbox or loads a `/model` variant. File parts
 *  that are neither an image nor a PDF, or that carry no `media://` locator,
 *  have nothing to load and are skipped. */
export function MessageAttachments({ message }: { message: UIMessage }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (message.role !== "user") return null;
  const { items, slides } = attachmentViews(message.parts);
  if (items.length === 0) return null;
  return (
    <>
      <MediaThumbnailRow
        aria-label="Attachments"
        className="ml-auto w-fit justify-end"
        items={items}
        onOpen={setOpenKey}
      />
      <MediaLightbox
        slides={slides}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
      />
    </>
  );
}
