"use client";

import { useState } from "react";
import { ImageThumbnailRow } from "@workspace/ui/components/custom/image-thumbnail";
import { MediaLightbox } from "@workspace/ui/components/custom/media-lightbox";
import type { UIMessage } from "ai";

import { storedImageSources } from "@/lib/services/media/urls";

/** A user message's attached images as thumbnails above its bubble, in
 *  stored order, each loading the `/model` variant lazily and opening a
 *  lightbox over this message's attachments, which shows the `/original`
 *  captioned with the `media://` locator. File parts without a `media://`
 *  locator have nothing to load and are skipped. */
export function MessageAttachments({ message }: { message: UIMessage }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (message.role !== "user") return null;
  const images = message.parts.flatMap((part, index) => {
    if (part.type !== "file") return [];
    const sources = storedImageSources(part.url);
    if (sources === null) return [];
    const key = String(index);
    const alt = part.filename ?? "Attached image";
    return [{ key, sources, alt, caption: part.url }];
  });
  if (images.length === 0) return null;
  return (
    <>
      <ImageThumbnailRow
        aria-label="Attached images"
        className="ml-auto w-fit justify-end"
        items={images.map(({ key, sources, alt }) => ({
          key,
          src: sources.thumbnail,
          alt,
        }))}
        onOpen={setOpenKey}
      />
      <MediaLightbox
        slides={images.map(({ key, sources, alt, caption }) => ({
          key,
          src: sources.original,
          alt,
          caption,
        }))}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
      />
    </>
  );
}
