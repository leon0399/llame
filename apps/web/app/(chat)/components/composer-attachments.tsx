"use client";

import { useRef, useState } from "react";
import { ImagePlusIcon } from "lucide-react";

import {
  MediaThumbnailRow,
  type MediaThumbnailItem,
} from "@workspace/ui/components/custom/media-thumbnail";
import {
  MediaLightbox,
  type MediaLightboxSlide,
  mediaCaption,
} from "@workspace/ui/components/custom/media-lightbox";

import { ATTACHABLE_PDF_TYPE } from "@/lib/services/media/uploads";
import { storedImageSources } from "@/lib/services/media/urls";
import { PromptInputButton } from "./prompt-input";
import type {
  ComposerAttachment,
  ComposerAttachments,
} from "./use-composer-attachments";

/** One composer attachment as a row tile: an image's object-URL preview, or a
 *  PDF's name with its stored `/original` href once the upload succeeds. An
 *  attachment still uploading or failed keeps its tile without a link. */
function thumbnailItem(item: ComposerAttachment): MediaThumbnailItem {
  const { key, file, previewUrl, status, descriptor } = item;
  if ((descriptor?.mediaType ?? file.type) === ATTACHABLE_PDF_TYPE) {
    return {
      key,
      status,
      kind: "pdf",
      name: descriptor?.name ?? file.name,
      href: descriptor
        ? storedImageSources(descriptor.locator)?.original
        : undefined,
    };
  }
  return { key, status, kind: "image", src: previewUrl, alt: file.name };
}

/** The lightbox slides of the uploaded images: each one's `/original`,
 *  captioned with its size and `media://` locator from its upload
 *  descriptor. Items still uploading or failed have no descriptor yet, and a
 *  PDF never enters the image slides. */
function uploadedSlides(
  items: ComposerAttachments["items"],
): Array<MediaLightboxSlide> {
  return items.flatMap(({ key, file, descriptor }) => {
    // `pages` is the PDF member's discriminant; a PDF never enters the slides.
    if (!descriptor || "pages" in descriptor) return [];
    const sources = storedImageSources(descriptor.locator);
    if (!sources) return [];
    const caption = mediaCaption(descriptor.locator, descriptor);
    return [{ key, src: sources.original, alt: file.name, caption }];
  });
}

/** The attached images and PDFs as thumbnails inside the input card, above
 *  the textarea; renders nothing while none are attached. An uploaded image
 *  thumbnail opens a lightbox over the composer's uploaded images; an
 *  uploaded PDF opens its `/original` in a new tab; one still uploading or
 *  failed opens nothing. */
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
      <MediaThumbnailRow
        aria-label="Attachments"
        className="mx-3 mt-3"
        items={attachments.items.map(thumbnailItem)}
        // The row opens only ready images, and a ready image has its upload
        // descriptor, so every opened key has a slide.
        onOpen={setOpenKey}
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
 *  limited to the kinds the selected model declares (`accept`); `disabled`
 *  while the selected model declares none. */
export function AttachFilesButton({
  onFiles,
  accept,
  disabled,
}: {
  onFiles: (files: Iterable<File>) => void;
  accept: string;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <PromptInputButton
        variant="ghost"
        size="icon"
        aria-label="Attach files"
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
        aria-label="Attach files"
        accept={accept}
        onChange={(event) => {
          onFiles(Array.from(event.currentTarget.files ?? []));
          // Clear so choosing the same file again still fires `change`.
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}

/** Paste handler for the textarea: clipboard image and PDF files attach; a
 *  paste that carries text stays an ordinary text paste. */
export function pasteFilesInto(add: (files: Iterable<File>) => void) {
  return (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const { clipboardData } = event;
    if (clipboardData.files.length === 0) return;
    if (clipboardData.types.includes("text/plain")) return;
    event.preventDefault();
    add(Array.from(clipboardData.files));
  };
}

/** Drop target handlers for the input card: dropped files attach. */
export function dropFilesInto(add: (files: Iterable<File>) => void) {
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
