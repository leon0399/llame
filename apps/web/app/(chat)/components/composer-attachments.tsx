"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { PaperclipIcon, PlusIcon } from "lucide-react";

import { Kbd } from "@workspace/ui/components/kbd";
import {
  detectPrimaryModifier,
  usePrimaryModifierKey,
} from "@workspace/ui/hooks/use-modifier-key";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
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
import { ComposerTooltip } from "./composer-tooltip";
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

/** The attached images and PDFs as cards inside the input card, above the
 *  textarea, matching a sent message's; renders nothing while none are
 *  attached. An uploaded image card opens a lightbox over the composer's
 *  uploaded images; an uploaded PDF opens its `/original` in a new tab; one
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
      <MediaThumbnailRow
        aria-label="Attachments"
        className="mx-3 mt-3"
        variant="card"
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

const UPLOAD_SHORTCUT_KEY = "u";

/** "Upload photos & files" with its shortcut shown the way the sidebar shows
 *  New Chat's and Search's. */
function UploadMenuItem({
  disabled,
  onUpload,
}: {
  disabled: boolean;
  onUpload: () => void;
}) {
  const modifierKey = usePrimaryModifierKey();
  return (
    <DropdownMenuItem
      disabled={disabled}
      onClick={onUpload}
      // Only announced while the shortcut is live.
      aria-keyshortcuts={
        disabled ? undefined : `${modifierKey === "⌘" ? "Meta" : "Control"}+U`
      }
    >
      <PaperclipIcon />
      <span>Upload photos & files</span>
      {/* Announced through `aria-keyshortcuts`, not the item's name. */}
      <Kbd aria-hidden="true" className="ml-auto">
        {`${modifierKey}+${UPLOAD_SHORTCUT_KEY.toUpperCase()}`}
      </Kbd>
    </DropdownMenuItem>
  );
}

/** The `+` button and its menu: the file upload, then the items the composer
 *  adds (filing into a project, a working directory). */
function ComposerAddDropdown({
  attachDisabled,
  onUpload,
  children,
}: {
  attachDisabled: boolean;
  onUpload: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <ComposerTooltip
        label="Add files and more"
        render={
          <DropdownMenuTrigger
            render={
              <PromptInputButton
                variant="ghost"
                size="icon"
                aria-label="Add files and more"
              />
            }
          />
        }
      >
        <PlusIcon size={16} />
      </ComposerTooltip>
      {/* Sized to its widest row, so a label never wraps beside its
          shortcut. */}
      <DropdownMenuContent align="start" className="w-max min-w-56">
        <UploadMenuItem disabled={attachDisabled} onUpload={onUpload} />
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ⌘U on Apple platforms, Ctrl+U elsewhere (no extra modifiers) opens the
 *  file picker from anywhere on the page while the model accepts uploads.
 *  It overrides the browser's view-source binding, as chat apps do. */
function useUploadShortcut(
  inputRef: RefObject<HTMLInputElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const isMac = detectPrimaryModifier() === "⌘";
    const onKey = (e: KeyboardEvent) => {
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (e.repeat || !modifier || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== UPLOAD_SHORTCUT_KEY) return;
      e.preventDefault();
      inputRef.current?.click();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inputRef, enabled]);
}

/** The toolbar's `+` menu. "Upload photos & files" opens a hidden multi-file
 *  input limited to the kinds the selected model declares (`accept`), and is
 *  disabled, shortcut included, while the selected model declares none. */
export function ComposerAddMenu({
  onFiles,
  accept,
  attachDisabled,
  children,
}: {
  onFiles: (files: Iterable<File>) => void;
  accept: string;
  attachDisabled: boolean;
  /** Menu items after the upload. */
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useUploadShortcut(inputRef, !attachDisabled);
  return (
    <>
      <ComposerAddDropdown
        attachDisabled={attachDisabled}
        onUpload={() => inputRef.current?.click()}
      >
        {children}
      </ComposerAddDropdown>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-label="Upload photos & files"
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
