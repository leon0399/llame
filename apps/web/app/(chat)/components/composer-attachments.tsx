"use client";

import { useRef, useState } from "react";
import { ImagePlusIcon } from "lucide-react";

import { ImageThumbnailRow } from "@workspace/ui/components/custom/image-thumbnail";
import {
  MediaLightbox,
  type MediaLightboxSlide,
} from "@workspace/ui/components/custom/media-lightbox";

import { mediaLightboxSlide } from "@/lib/services/media/lightbox";
import { ATTACHABLE_IMAGE_TYPES } from "@/lib/services/media/uploads";
import { PromptInputButton } from "./prompt-input";
import type { ComposerAttachments } from "./use-composer-attachments";

/** One open of the composer lightbox: the uploaded images' slides as they
 *  stood then, so an upload finishing meanwhile cannot shift the slides. */
type ComposerLightboxSession = {
  slides: ReadonlyArray<MediaLightboxSlide>;
  index: number;
};

/** A session opening on the item `key` over the uploaded items' slides, or
 *  `null` when that item has no descriptor yet (uploading or failed). */
function composerLightboxSession(
  items: ComposerAttachments["items"],
  key: string,
): ComposerLightboxSession | null {
  const slides: Array<MediaLightboxSlide> = [];
  let index = -1;
  for (const item of items) {
    const slide = item.descriptor && mediaLightboxSlide(item.descriptor);
    if (!slide) continue;
    if (item.key === key) index = slides.length;
    slides.push(slide);
  }
  return index === -1 ? null : { slides, index };
}

/** The attached images as thumbnails inside the input card, above the
 *  textarea; renders nothing while none are attached. Activating an uploaded
 *  thumbnail opens a lightbox over the composer's uploaded images only, built
 *  from their upload descriptors; a thumbnail still uploading or failed
 *  opens nothing. */
export function ComposerAttachmentRow({
  attachments,
}: {
  attachments: ComposerAttachments;
}) {
  const [session, setSession] = useState<ComposerLightboxSession | null>(null);
  if (attachments.items.length === 0) return null;
  const open = (key: string) => {
    const opened = composerLightboxSession(attachments.items, key);
    if (opened !== null) setSession(opened);
  };
  return (
    <>
      <ImageThumbnailRow
        aria-label="Attached images"
        className="mx-3 mt-3"
        items={attachments.items.map((item) => ({
          key: item.key,
          src: item.previewUrl,
          alt: item.file.name,
          status: item.status,
        }))}
        onOpen={open}
        onRemove={attachments.remove}
        onRetry={attachments.retry}
        onReorder={attachments.reorder}
      />
      <MediaLightbox
        slides={session?.slides ?? []}
        index={session?.index ?? null}
        onClose={() => setSession(null)}
      />
    </>
  );
}

/** The toolbar's file picker: a button opening a hidden multi-file input
 *  limited to the attachable image types. */
export function AttachImagesButton({
  onFiles,
}: {
  onFiles: (files: Iterable<File>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <PromptInputButton
        variant="ghost"
        size="icon"
        aria-label="Attach images"
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlusIcon size={16} />
      </PromptInputButton>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-label="Attach images"
        accept={ATTACHABLE_IMAGE_TYPES.join(",")}
        onChange={(event) => {
          onFiles(Array.from(event.currentTarget.files ?? []));
          // Clear so choosing the same file again still fires `change`.
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}

/** Paste handler for the textarea: clipboard image files attach; a paste
 *  that carries text stays an ordinary text paste. */
export function pasteImagesInto(add: (files: Iterable<File>) => void) {
  return (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const { clipboardData } = event;
    if (clipboardData.files.length === 0) return;
    if (clipboardData.types.includes("text/plain")) return;
    event.preventDefault();
    add(Array.from(clipboardData.files));
  };
}

/** Drop target handlers for the input card: dropped files attach. Thumbnail
 *  drags carry no files and are left to the thumbnail row. */
export function dropImagesInto(add: (files: Iterable<File>) => void) {
  return {
    onDragOver: (event: React.DragEvent<HTMLFormElement>) => {
      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
    },
    onDrop: (event: React.DragEvent<HTMLFormElement>) => {
      if (event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      add(Array.from(event.dataTransfer.files));
    },
  };
}
