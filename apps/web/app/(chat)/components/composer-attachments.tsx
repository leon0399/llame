"use client";

import { useRef } from "react";
import { ImagePlusIcon } from "lucide-react";

import { ImageThumbnailRow } from "@workspace/ui/components/custom/image-thumbnail";

import { ATTACHABLE_IMAGE_TYPES } from "@/lib/services/media/uploads";
import { PromptInputButton } from "./prompt-input";
import type { ComposerAttachments } from "./use-composer-attachments";

/** The attached images as thumbnails inside the input card, above the
 *  textarea; renders nothing while none are attached. */
export function ComposerAttachmentRow({
  attachments,
}: {
  attachments: ComposerAttachments;
}) {
  if (attachments.items.length === 0) return null;
  return (
    <ImageThumbnailRow
      aria-label="Attached images"
      className="mx-3 mt-3"
      items={attachments.items.map((item) => ({
        key: item.key,
        src: item.previewUrl,
        alt: item.file.name,
        status: item.status,
      }))}
      onRemove={attachments.remove}
      onRetry={attachments.retry}
      onReorder={attachments.reorder}
    />
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
