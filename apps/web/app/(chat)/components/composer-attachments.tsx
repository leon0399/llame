"use client";

import { useRef, useState } from "react";
import { ImagePlusIcon } from "lucide-react";

import { ImageThumbnailRow } from "@workspace/ui/components/custom/image-thumbnail";
import {
  MediaLightbox,
  type MediaLightboxSlide,
  mediaCaption,
} from "@workspace/ui/components/custom/media-lightbox";

import { ATTACHABLE_IMAGE_TYPES } from "@/lib/services/media/uploads";
import { storedImageSources } from "@/lib/services/media/urls";
import { PromptInputButton } from "./prompt-input";
import type { ComposerAttachments } from "./use-composer-attachments";

/** The lightbox slides of the uploaded items: each one's `/original`,
 *  captioned with its size and `media://` locator from its upload
 *  descriptor. Items still uploading or failed have no descriptor yet. */
function uploadedSlides(
  items: ComposerAttachments["items"],
): Array<MediaLightboxSlide> {
  return items.flatMap(({ key, file, descriptor }) => {
    const sources = descriptor && storedImageSources(descriptor.locator);
    if (!descriptor || !sources) return [];
    const caption = mediaCaption(descriptor.locator, descriptor);
    return [{ key, src: sources.original, alt: file.name, caption }];
  });
}

/** The attached images as thumbnails inside the input card, above the
 *  textarea; renders nothing while none are attached. An uploaded
 *  thumbnail opens a lightbox over the composer's uploaded images; one
 *  still uploading or failed opens nothing. */
export function ComposerAttachmentRow({
  attachments,
}: {
  attachments: ComposerAttachments;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (attachments.items.length === 0) return null;
  const slides = uploadedSlides(attachments.items);
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
        // Only uploaded images open, so a key never waits for its upload.
        onOpen={(key) => {
          if (slides.some((slide) => slide.key === key)) setOpenKey(key);
        }}
        onRemove={attachments.remove}
        onRetry={attachments.retry}
      />
      <MediaLightbox
        slides={slides}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
      />
    </>
  );
}

/** The toolbar's file picker: a button opening a hidden multi-file input
 *  limited to the attachable image types; `disabled` while the selected
 *  model has no image input. */
export function AttachImagesButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: Iterable<File>) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <PromptInputButton
        variant="ghost"
        size="icon"
        aria-label="Attach images"
        disabled={disabled}
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

/** Drop target handlers for the input card: dropped files attach. */
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
